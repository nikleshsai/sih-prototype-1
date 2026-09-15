/**
 * Admin Routes — ALL require authenticate + requireRole('admin')
 * Server-side enforcement on every endpoint.
 * Migrated to async Supabase JS client.
 */
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { supabase } = require('../../config/db');
const { buildMatchPlan, commitMatchPlan } = require('../../services/matching');
const { optimizeRoute } = require('../../services/logistics');
const { getDistrictForecast, getStateLevelDemand, getSupplyDemandGap } = require('../../services/forecasting');

// ============================================================
// DASHBOARD STATS
// ============================================================
router.get('/dashboard', async (req, res) => {
  try {
    const [
      { count: farmerTotal },
      { count: farmerPending },
      { count: farmerApproved },
      { count: farmerRejected },
      { count: customerTotal },
      { count: customerPending },
      { count: customerApproved },
      { count: orderTotal },
      { count: orderPending },
      { count: orderFulfillment },
      { count: orderDelivered },
      { count: activeListings },
      { data: supplyData },
      { data: paymentData },
      { count: settlementPending },
      { count: logisticsPlanned },
      { count: logisticsTransit },
      { data: recentAudit },
    ] = await Promise.all([
      supabase.from('farmer_profiles').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('farmer_profiles').select('*', { count: 'exact', head: true }).eq('verification_status', 'pending').is('deleted_at', null),
      supabase.from('farmer_profiles').select('*', { count: 'exact', head: true }).eq('verification_status', 'approved').is('deleted_at', null),
      supabase.from('farmer_profiles').select('*', { count: 'exact', head: true }).eq('verification_status', 'rejected').is('deleted_at', null),
      supabase.from('customer_profiles').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('customer_profiles').select('*', { count: 'exact', head: true }).eq('verification_status', 'pending').is('deleted_at', null),
      supabase.from('customer_profiles').select('*', { count: 'exact', head: true }).eq('verification_status', 'approved').is('deleted_at', null),
      supabase.from('orders').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending').is('deleted_at', null),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'in_fulfillment').is('deleted_at', null),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'delivered').is('deleted_at', null),
      supabase.from('crop_listings').select('*', { count: 'exact', head: true }).eq('status', 'active').is('deleted_at', null),
      supabase.from('crop_listings').select('available_kg').eq('supply_type', 'current').eq('status', 'active'),
      supabase.from('payments').select('amount_paise').eq('payment_status', 'paid'),
      supabase.from('farmer_settlements').select('*', { count: 'exact', head: true }).eq('settlement_status', 'pending'),
      supabase.from('logistics').select('*', { count: 'exact', head: true }).eq('status', 'planned'),
      supabase.from('logistics').select('*', { count: 'exact', head: true }).eq('status', 'in_transit'),
      supabase.from('audit_logs').select('action, user_email, result, timestamp').order('timestamp', { ascending: false }).limit(5),
    ]);

    const totalAvailableKg = (supplyData || []).reduce((s, r) => s + (r.available_kg || 0), 0);
    const totalPaidPaise = (paymentData || []).reduce((s, r) => s + (r.amount_paise || 0), 0);

    res.json({
      farmers: { total: farmerTotal, pending: farmerPending, approved: farmerApproved, rejected: farmerRejected },
      customers: { total: customerTotal, pending: customerPending, approved: customerApproved },
      orders: { total: orderTotal, pending: orderPending, in_fulfillment: orderFulfillment, delivered: orderDelivered },
      supply: { active_listings: activeListings, total_available_kg: Math.round(totalAvailableKg) },
      payments: { total_paid: totalPaidPaise, total_paid_inr: Math.round(totalPaidPaise / 100), pending_settlements: settlementPending },
      logistics: { planned: logisticsPlanned, in_transit: logisticsTransit },
      recent_audit: recentAudit || [],
    });
  } catch (err) {
    console.error('[ADMIN DASHBOARD]', err.message);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

// ============================================================
// FARMER MANAGEMENT
// ============================================================
router.get('/farmers', async (req, res) => {
  try {
    let query = supabase
      .from('farmer_profiles')
      .select('*, users!farmer_profiles_user_id_fkey(email, status, created_at)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (req.query.status) query = query.eq('verification_status', req.query.status);
    if (req.query.district) query = query.eq('district', req.query.district);

    const { data: farmers, error } = await query;
    if (error) throw error;

    // Flatten user fields
    const result = (farmers || []).map(f => ({
      ...f,
      email: f.users?.email,
      account_status: f.users?.status,
      registered_at: f.users?.created_at,
      users: undefined,
    }));

    res.json({ farmers: result });
  } catch (err) {
    console.error('[ADMIN FARMERS]', err.message);
    res.status(500).json({ error: 'Failed to fetch farmers' });
  }
});

router.get('/farmers/:id', async (req, res) => {
  try {
    const { data: farmer, error } = await supabase
      .from('farmer_profiles')
      .select('*, users!farmer_profiles_user_id_fkey(email, status)')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .single();

    if (error || !farmer) return res.status(404).json({ error: 'Farmer not found' });

    const { data: lands } = await supabase.from('farm_lands').select('*').eq('farmer_profile_id', farmer.id);
    const { data: listings } = await supabase.from('crop_listings').select('*').eq('farmer_profile_id', farmer.id).is('deleted_at', null).order('created_at', { ascending: false });

    res.json({
      farmer: { ...farmer, email: farmer.users?.email, account_status: farmer.users?.status, users: undefined },
      lands: lands || [],
      listings: listings || [],
    });
  } catch (err) {
    console.error('[ADMIN FARMER DETAIL]', err.message);
    res.status(500).json({ error: 'Failed to fetch farmer details' });
  }
});

router.patch('/farmers/:id/verify',
  body('status').isIn(['approved', 'rejected', 'info_required']),
  body('notes').optional().isString().isLength({ max: 1000 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: farmer } = await supabase.from('farmer_profiles').select('*').eq('id', req.params.id).is('deleted_at', null).maybeSingle();
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

    const { error } = await supabase.from('farmer_profiles').update({
      verification_status: req.body.status,
      verification_notes: req.body.notes || null,
      verified_by: req.user.id,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    if (error) return res.status(500).json({ error: 'Update failed' });

    req.audit('FARMER_VERIFY', 'farmer_profiles', parseInt(req.params.id), 'success', {
      new_status: req.body.status, farmer_name: farmer.full_name,
    });

    res.json({ message: `Farmer ${req.body.status} successfully` });
  }
);

router.delete('/farmers/:id', async (req, res) => {
  await supabase.from('farmer_profiles').update({ deleted_at: new Date().toISOString() }).eq('id', req.params.id);
  req.audit('FARMER_DELETE', 'farmer_profiles', parseInt(req.params.id), 'success', {});
  res.json({ message: 'Farmer soft-deleted' });
});

// ============================================================
// CUSTOMER MANAGEMENT
// ============================================================
router.get('/customers', async (req, res) => {
  try {
    let query = supabase
      .from('customer_profiles')
      .select('*, users!customer_profiles_user_id_fkey(email, status)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (req.query.status) query = query.eq('verification_status', req.query.status);

    const { data: customers, error } = await query;
    if (error) throw error;

    const result = (customers || []).map(c => ({
      ...c, email: c.users?.email, account_status: c.users?.status, users: undefined,
    }));
    res.json({ customers: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

router.patch('/customers/:id/verify',
  body('status').isIn(['approved', 'rejected']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: customer } = await supabase.from('customer_profiles').select('*').eq('id', req.params.id).is('deleted_at', null).maybeSingle();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    await supabase.from('customer_profiles').update({
      verification_status: req.body.status, verified_by: req.user.id,
      verified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    req.audit('CUSTOMER_VERIFY', 'customer_profiles', parseInt(req.params.id), 'success', { new_status: req.body.status });
    res.json({ message: `Customer ${req.body.status} successfully` });
  }
);

// ============================================================
// ORDER MANAGEMENT
// ============================================================
router.get('/orders', async (req, res) => {
  try {
    let query = supabase
      .from('orders')
      .select('*, customer_profiles!orders_customer_profile_id_fkey(full_name, business_name, district)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (req.query.status) query = query.eq('status', req.query.status);

    const { data: orders, error } = await query;
    if (error) throw error;

    const result = (orders || []).map(o => ({
      ...o,
      customer_name: o.customer_profiles?.full_name,
      business_name: o.customer_profiles?.business_name,
      customer_district: o.customer_profiles?.district,
      customer_profiles: undefined,
    }));
    res.json({ orders: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('*, customer_profiles!orders_customer_profile_id_fkey(full_name, business_name, mobile, district)')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .single();

    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { data: assignments } = await supabase
      .from('order_farmer_assignments')
      .select('*, farmer_profiles!order_farmer_assignments_farmer_profile_id_fkey(full_name, district, mobile)')
      .eq('order_id', order.id);

    const { data: logisticsRows } = await supabase
      .from('logistics')
      .select('*')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: payments } = await supabase.from('payments').select('*').eq('order_id', order.id);

    res.json({
      order: { ...order, customer_name: order.customer_profiles?.full_name, customer_profiles: undefined },
      assignments: (assignments || []).map(a => ({
        ...a, farmer_name: a.farmer_profiles?.full_name, district: a.farmer_profiles?.district,
        farmer_mobile: a.farmer_profiles?.mobile, farmer_profiles: undefined,
      })),
      logistics: logisticsRows?.[0] || null,
      payments: payments || [],
    });
  } catch (err) {
    console.error('[ADMIN ORDER DETAIL]', err.message);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

// Match order (build plan preview)
router.post('/orders/:id/match', async (req, res) => {
  try {
    const plan = await buildMatchPlan(parseInt(req.params.id));
    req.audit('ORDER_MATCH_PREVIEW', 'orders', parseInt(req.params.id), 'success', { farmer_count: plan.assignments.length });
    res.json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Commit match plan
router.post('/orders/:id/commit-match',
  body('assignments').isArray({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    try {
      const result = await commitMatchPlan(parseInt(req.params.id), req.body.assignments);
      req.audit('ORDER_MATCH_COMMIT', 'orders', parseInt(req.params.id), 'success', { farmers: req.body.assignments.length });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

router.patch('/orders/:id/status',
  body('status').isIn(['confirmed', 'in_fulfillment', 'delivered', 'cancelled', 'disputed']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: order } = await supabase.from('orders').select('*').eq('id', req.params.id).is('deleted_at', null).maybeSingle();
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const updates = { status: req.body.status, updated_at: new Date().toISOString() };
    if (req.body.status === 'delivered') updates.delivery_date_actual = new Date().toISOString().split('T')[0];

    await supabase.from('orders').update(updates).eq('id', order.id);

    req.audit('ORDER_STATUS_CHANGE', 'orders', order.id, 'success', {
      from: order.status, to: req.body.status, order_ref: order.order_ref,
    });
    res.json({ message: 'Order status updated' });
  }
);

// ============================================================
// LOGISTICS MANAGEMENT
// ============================================================
router.get('/logistics', async (req, res) => {
  try {
    const { data: logistics } = await supabase
      .from('logistics')
      .select('*, orders!logistics_order_id_fkey(order_ref, crop_name, delivery_location)')
      .order('created_at', { ascending: false });

    const result = (logistics || []).map(l => ({
      ...l, order_ref: l.orders?.order_ref, crop_name: l.orders?.crop_name,
      delivery_location: l.orders?.delivery_location, orders: undefined,
    }));
    res.json({ logistics: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logistics' });
  }
});

router.post('/logistics/plan',
  body('order_id').isInt(),
  body('vehicle_type').isIn(['mini_truck', 'medium_truck', 'large_truck', 'tempo', 'refrigerated']),
  body('vehicle_capacity_kg').isFloat({ min: 100 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { order_id, vehicle_type, vehicle_capacity_kg, provider_name, vehicle_number, driver_name, driver_mobile } = req.body;

    const { data: order } = await supabase.from('orders').select('*').eq('id', order_id).is('deleted_at', null).maybeSingle();
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { data: assignments } = await supabase
      .from('order_farmer_assignments')
      .select('quantity_kg_assigned, farmer_profiles!order_farmer_assignments_farmer_profile_id_fkey(id, full_name, gps_lat, gps_lng, address)')
      .eq('order_id', order_id)
      .neq('farmer_status', 'rejected');

    const { data: customerProfile } = await supabase
      .from('customer_profiles')
      .select('gps_lat, gps_lng, address, full_name')
      .eq('id', order.customer_profile_id)
      .maybeSingle();

    const pickups = (assignments || []).map(a => ({
      farmer_id: a.farmer_profiles?.id, farmer_name: a.farmer_profiles?.full_name,
      address: a.farmer_profiles?.address, gps_lat: a.farmer_profiles?.gps_lat,
      gps_lng: a.farmer_profiles?.gps_lng, quantity_kg: a.quantity_kg_assigned,
    }));

    const routePlan = optimizeRoute({
      pickups,
      dropoff: {
        address: order.delivery_location,
        gps_lat: customerProfile?.gps_lat || order.delivery_gps_lat,
        gps_lng: customerProfile?.gps_lng || order.delivery_gps_lng,
        customer_name: customerProfile?.full_name,
      },
      vehicleCapacityKg: vehicle_capacity_kg,
    });

    const { data: logRow, error: logErr } = await supabase.from('logistics').insert({
      order_id, provider_name: provider_name || null, vehicle_type,
      vehicle_capacity_kg, vehicle_number: vehicle_number || null,
      driver_name: driver_name || null, driver_mobile: driver_mobile || null,
      pickup_plan: JSON.stringify(assignments || []),
      route_plan: JSON.stringify(routePlan),
      delivery_location: order.delivery_location,
      delivery_gps_lat: customerProfile?.gps_lat,
      delivery_gps_lng: customerProfile?.gps_lng,
      estimated_distance_km: routePlan.total_distance_km,
      estimated_duration_min: routePlan.estimated_duration_min,
      status: 'planned',
    }).select('id').single();

    if (logErr) return res.status(500).json({ error: 'Failed to create logistics plan' });

    req.audit('LOGISTICS_PLAN', 'logistics', logRow.id, 'success', { order_id, vehicle_type });
    res.status(201).json({ logistics_id: logRow.id, route_plan: routePlan });
  }
);

router.patch('/logistics/:id/status',
  body('status').isIn(['loading', 'in_transit', 'delivered', 'failed']),
  async (req, res) => {
    const updates = { status: req.body.status, updated_at: new Date().toISOString() };
    if (req.body.status === 'in_transit') updates.dispatched_at = new Date().toISOString();
    if (req.body.status === 'delivered') updates.delivered_at = new Date().toISOString();

    await supabase.from('logistics').update(updates).eq('id', req.params.id);
    req.audit('LOGISTICS_STATUS', 'logistics', parseInt(req.params.id), 'success', { status: req.body.status });
    res.json({ message: 'Logistics status updated' });
  }
);

// ============================================================
// ANALYTICS
// ============================================================
router.get('/analytics/demand', async (req, res) => {
  const { crop, district, state } = req.query;
  if (!crop) return res.status(400).json({ error: 'crop parameter required' });

  try {
    if (district) {
      res.json(await getSupplyDemandGap(crop, district, state || 'Tamil Nadu'));
    } else {
      res.json(await getStateLevelDemand(crop, state || 'Tamil Nadu'));
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute demand analytics' });
  }
});

router.get('/analytics/top-crops', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

    const { data } = await supabase
      .from('demand_history')
      .select('crop_name, region_district, quantity_kg_sold')
      .gte('sale_date', dateStr);

    // Aggregate client-side since PostgREST doesn't support GROUP BY
    const grouped = {};
    for (const row of (data || [])) {
      const key = `${row.crop_name}|||${row.region_district}`;
      if (!grouped[key]) grouped[key] = { crop_name: row.crop_name, region_district: row.region_district, total_sold: 0, days_data: 0 };
      grouped[key].total_sold += row.quantity_kg_sold;
      grouped[key].days_data++;
    }

    const topCrops = Object.values(grouped)
      .map(g => ({ ...g, avg_daily: Math.round(g.total_sold / g.days_data) }))
      .sort((a, b) => b.total_sold - a.total_sold)
      .slice(0, 20);

    res.json({ top_crops: topCrops });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch top crops' });
  }
});

router.get('/analytics/payments', async (req, res) => {
  try {
    const { data: payments } = await supabase.from('payments').select('payment_phase, payment_status, amount_paise');
    const { data: settlements } = await supabase.from('farmer_settlements').select('settlement_status, amount_inr');

    // Aggregate
    const payGrouped = {};
    for (const p of (payments || [])) {
      const key = `${p.payment_phase}|||${p.payment_status}`;
      if (!payGrouped[key]) payGrouped[key] = { payment_phase: p.payment_phase, payment_status: p.payment_status, count: 0, total_paise: 0 };
      payGrouped[key].count++;
      payGrouped[key].total_paise += p.amount_paise;
    }

    const settGrouped = {};
    for (const s of (settlements || [])) {
      if (!settGrouped[s.settlement_status]) settGrouped[s.settlement_status] = { settlement_status: s.settlement_status, count: 0, total_inr: 0 };
      settGrouped[s.settlement_status].count++;
      settGrouped[s.settlement_status].total_inr += s.amount_inr;
    }

    res.json({ payment_summary: Object.values(payGrouped), settlement_summary: Object.values(settGrouped) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment analytics' });
  }
});

// ============================================================
// AUDIT LOG VIEWER
// ============================================================
router.get('/audit', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    let query = supabase.from('audit_logs').select('*', { count: 'exact' }).order('timestamp', { ascending: false }).range(offset, offset + limit - 1);
    if (req.query.action) query = query.ilike('action', `%${req.query.action}%`);

    const { data: logs, count: total, error } = await query;
    if (error) throw error;

    res.json({ logs: logs || [], total: total || 0, page, limit, pages: Math.ceil((total || 0) / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.get('/audit/security-events', async (req, res) => {
  const { data: events } = await supabase
    .from('audit_logs')
    .select('*')
    .in('action', ['LOGIN_FAILED', 'LOGIN_BLOCKED', 'FARMER_VERIFY', 'CUSTOMER_VERIFY', 'ORDER_STATUS_CHANGE', 'LOGOUT'])
    .order('timestamp', { ascending: false })
    .limit(100);

  res.json({ events: events || [] });
});

// Settlement management
router.post('/settlements/:assignmentId/process', async (req, res) => {
  const { data: assignment } = await supabase.from('order_farmer_assignments').select('*').eq('id', req.params.assignmentId).maybeSingle();
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

  const amount = assignment.quantity_kg_assigned * (assignment.price_per_kg_agreed || 20);
  const { data: existing } = await supabase.from('farmer_settlements').select('id').eq('order_farmer_assignment_id', assignment.id).maybeSingle();

  const { v4: uuidv4 } = require('uuid');

  if (!existing) {
    await supabase.from('farmer_settlements').insert({
      order_farmer_assignment_id: assignment.id,
      farmer_profile_id: assignment.farmer_profile_id,
      amount_inr: amount,
      settlement_status: 'processed',
      settlement_ref: 'SETTLE-' + uuidv4().substring(0, 8).toUpperCase(),
      settled_at: new Date().toISOString(),
    });
  } else {
    await supabase.from('farmer_settlements').update({
      settlement_status: 'processed', settled_at: new Date().toISOString(),
    }).eq('order_farmer_assignment_id', assignment.id);
  }

  req.audit('FARMER_SETTLEMENT', 'farmer_settlements', assignment.id, 'success', { amount, farmer_id: assignment.farmer_profile_id });
  res.json({ message: 'Settlement processed', amount_inr: amount });
});

module.exports = router;
