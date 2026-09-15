/**
 * Logistics Route Optimization Service
 * Pure algorithm — no database access. Unchanged from original.
 */

/**
 * Nearest-neighbor TSP heuristic for pickup route optimization.
 * Returns an optimized stop order for multi-farmer pickups.
 */
function optimizeRoute({ pickups, dropoff, vehicleCapacityKg }) {
  if (!pickups || pickups.length === 0) {
    return {
      stops: [],
      total_distance_km: 0,
      estimated_duration_min: 0,
      vehicle_utilization_pct: 0,
    };
  }

  // Start from first pickup (assume depot is first pickup point)
  const unvisited = [...pickups];
  const route = [];
  let currentLat = pickups[0].gps_lat;
  let currentLng = pickups[0].gps_lng;
  let totalDistance = 0;
  let totalLoad = 0;

  // Nearest-neighbor greedy for pickups
  while (unvisited.length > 0) {
    let nearest = null;
    let nearestDist = Infinity;
    let nearestIdx = -1;

    for (let i = 0; i < unvisited.length; i++) {
      const p = unvisited[i];
      const d = haversineKm(currentLat, currentLng, p.gps_lat, p.gps_lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
        nearestIdx = i;
      }
    }

    if (nearest) {
      route.push({
        stop_order: route.length + 1,
        type: 'pickup',
        farmer_id: nearest.farmer_id,
        farmer_name: nearest.farmer_name,
        address: nearest.address,
        gps_lat: nearest.gps_lat,
        gps_lng: nearest.gps_lng,
        quantity_kg: nearest.quantity_kg,
        distance_from_prev_km: Math.round(nearestDist * 10) / 10,
      });
      totalDistance += nearestDist;
      totalLoad += nearest.quantity_kg;
      currentLat = nearest.gps_lat;
      currentLng = nearest.gps_lng;
      unvisited.splice(nearestIdx, 1);
    }
  }

  // Final leg: last pickup to dropoff
  const lastLeg = haversineKm(currentLat, currentLng, dropoff.gps_lat, dropoff.gps_lng);
  totalDistance += lastLeg;

  route.push({
    stop_order: route.length + 1,
    type: 'dropoff',
    customer_name: dropoff.customer_name,
    address: dropoff.address,
    gps_lat: dropoff.gps_lat,
    gps_lng: dropoff.gps_lng,
    quantity_kg: totalLoad,
    distance_from_prev_km: Math.round(lastLeg * 10) / 10,
  });

  // Estimate duration: 50 km/h average + 15 min per stop for loading
  const drivingMin = Math.round((totalDistance / 50) * 60);
  const loadingMin = pickups.length * 15;
  const totalMin = drivingMin + loadingMin;

  const utilization = vehicleCapacityKg > 0
    ? Math.min(100, Math.round((totalLoad / vehicleCapacityKg) * 100))
    : 0;

  return {
    stops: route,
    total_distance_km: Math.round(totalDistance * 10) / 10,
    estimated_duration_min: totalMin,
    vehicle_utilization_pct: utilization,
    total_load_kg: Math.round(totalLoad),
    farmer_count: pickups.length,
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }

module.exports = { optimizeRoute };
