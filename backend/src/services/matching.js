/**
 * Farmer-Customer Matching & Multi-Farmer Aggregation Engine — Supabase version
 */
const { supabase } = require('../config/db');

function haversineKm(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 9999;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toRad(deg) { return deg * Math.PI / 180; }

async function findCandidateListings(order) {
  const { data: listings } = await supabase
    .from('crop_listings')
    .select(`
      id, farmer_profile_id, crop_name, crop_variety,
      supply_type, available_kg, estimated_yield_avg_kg,
      expected_harvest_date, grade, price_per_kg_expected, minimum_order_kg, confidence_level,
      farmer_profiles!crop_listings_farmer_profile_id_fkey(full_name, district, gps_lat, gps_lng, verification_status)
    `)
    .eq('crop_name', order.crop_name)
    .eq('status', 'active')
    .is('deleted_at', null)
    .eq('farmer_profiles.verification_status', 'approved')
    .is('farmer_profiles.deleted_at', null);

  // Fetch fulfillment rates (client-side calculation)
  const { data: allAssignments } = await supabase
    .from('order_farmer_assignments')
    .select('farmer_profile_id, farmer_status');

  const rateMap = {};
  if (allAssignments) {
    const grouped = {};
    for (const a of allAssignments) {
      if (!grouped[a.farmer_profile_id]) grouped[a.farmer_profile_id] = { fulfilled: 0, total: 0 };
      grouped[a.farmer_profile_id].total++;
      if (a.farmer_status === 'fulfilled') grouped[a.farmer_profile_id].fulfilled++;
    }
    for (const [id, g] of Object.entries(grouped)) {
      rateMap[id] = g.total > 0 ? g.fulfilled / g.total : 0.5;
    }
  }

  const filtered = (listings || []).filter(l => {
    if (!l.farmer_profiles) return false;
    if (order.grade_required && l.grade > order.grade_required) return false;
    if (order.price_per_kg_max && l.price_per_kg_expected && l.price_per_kg_expected > order.price_per_kg_max) return false;
    if (l.supply_type === 'current') return (l.available_kg || 0) >= (l.minimum_order_kg || 0);
    if (l.supply_type === 'expected') return l.expected_harvest_date && l.expected_harvest_date <= order.delivery_date_required;
    return false;
  });

  const scored = filtered.map(l => {
    const distance = haversineKm(
      order.delivery_gps_lat, order.delivery_gps_lng,
      l.farmer_profiles.gps_lat, l.farmer_profiles.gps_lng
    );
    const capacity = l.supply_type === 'current' ? l.available_kg : (l.estimated_yield_avg_kg || 0);
    const priceScore = order.price_per_kg_max && l.price_per_kg_expected
      ? Math.max(0, 1 - (l.price_per_kg_expected / order.price_per_kg_max)) : 0.5;
    const gradeScore = l.grade === 'A' ? 1 : l.grade === 'B' ? 0.7 : 0.4;
    const distanceScore = Math.max(0, 1 - distance / 300);
    const reliabilityScore = rateMap[l.farmer_profile_id] ?? 0.5;
    const totalScore = (distanceScore * 0.3) + (priceScore * 0.25) + (gradeScore * 0.25) + (reliabilityScore * 0.2);

    return {
      ...l,
      farmer_name: l.farmer_profiles.full_name,
      district: l.farmer_profiles.district,
      gps_lat: l.farmer_profiles.gps_lat,
      gps_lng: l.farmer_profiles.gps_lng,
      farmer_profiles: undefined,
      distance_km: Math.round(distance), capacity_kg: capacity, score: totalScore,
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

async function buildMatchPlan(orderId) {
  const { data: orderRow } = await supabase
    .from('orders')
    .select('*, customer_profiles!orders_customer_profile_id_fkey(gps_lat, gps_lng)')
    .eq('id', orderId)
    .maybeSingle();

  if (!orderRow) throw new Error('Order not found');
  if (orderRow.status !== 'pending') throw new Error('Order is not in pending state');

  const order = {
    ...orderRow,
    delivery_gps_lat: orderRow.delivery_gps_lat || orderRow.customer_profiles?.gps_lat,
    delivery_gps_lng: orderRow.delivery_gps_lng || orderRow.customer_profiles?.gps_lng,
  };

  const candidates = await findCandidateListings(order);
  if (!candidates.length) {
    return { success: false, order_id: orderId, message: 'No matching supply found for this order.', assignments: [] };
  }

  const assignments = [];
  let remaining = order.quantity_kg_requested;

  for (const listing of candidates) {
    if (remaining <= 0) break;
    const assign = Math.min(listing.capacity_kg, remaining);
    if (assign < listing.minimum_order_kg && assign < remaining) continue;

    assignments.push({
      farmer_profile_id: listing.farmer_profile_id,
      farmer_name: listing.farmer_name,
      crop_listing_id: listing.id,
      supply_type: listing.supply_type,
      crop_variety: listing.crop_variety,
      grade: listing.grade,
      quantity_kg_assigned: Math.round(assign * 100) / 100,
      price_per_kg_agreed: listing.price_per_kg_expected || null,
      distance_km: listing.distance_km,
      score: Math.round(listing.score * 100) / 100,
      farmer_district: listing.district,
      expected_harvest_date: listing.expected_harvest_date,
    });
    remaining -= assign;
  }

  const fulfilled = order.quantity_kg_requested - remaining;
  const fulfillmentPct = Math.round((fulfilled / order.quantity_kg_requested) * 100);

  return {
    success: fulfillmentPct >= 90, order_id: orderId,
    quantity_requested_kg: order.quantity_kg_requested,
    quantity_matched_kg: Math.round(fulfilled),
    fulfillment_percentage: fulfillmentPct,
    farmer_count: assignments.length, assignments,
    message: fulfillmentPct >= 100
      ? `Fully matched from ${assignments.length} farmer(s)`
      : fulfillmentPct >= 90
        ? `Partially matched (${fulfillmentPct}%) from ${assignments.length} farmer(s)`
        : `Insufficient supply. Only ${fulfillmentPct}% can be matched.`,
  };
}

async function commitMatchPlan(orderId, assignments) {
  for (const a of assignments) {
    await supabase.from('order_farmer_assignments').insert({
      order_id: orderId, farmer_profile_id: a.farmer_profile_id,
      crop_listing_id: a.crop_listing_id,
      quantity_kg_assigned: a.quantity_kg_assigned,
      price_per_kg_agreed: a.price_per_kg_agreed,
      farmer_status: 'pending',
    });

    // Reserve capacity for current supply listings
    const { data: listing } = await supabase
      .from('crop_listings')
      .select('available_kg, supply_type')
      .eq('id', a.crop_listing_id)
      .maybeSingle();

    if (listing && listing.supply_type === 'current') {
      await supabase.from('crop_listings').update({
        available_kg: Math.max(0, (listing.available_kg || 0) - a.quantity_kg_assigned),
        updated_at: new Date().toISOString(),
      }).eq('id', a.crop_listing_id);
    }
  }

  const totalFulfilled = assignments.reduce((s, a) => s + a.quantity_kg_assigned, 0);
  await supabase.from('orders').update({
    status: 'matched', quantity_kg_fulfilled: totalFulfilled,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId);

  return { success: true, message: 'Match committed successfully' };
}

module.exports = { findCandidateListings, buildMatchPlan, commitMatchPlan, haversineKm };
