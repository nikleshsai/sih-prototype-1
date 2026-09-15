/**
 * Customer Routes — All protected by authenticate + requireRole('customer')
 * Migrated to async Supabase JS client.
 */
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../../config/db');
const { requireApprovedCustomer } = require('../../middleware/rbac');

let Razorpay;
try { Razorpay = require('razorpay'); } catch (_) {}
const crypto = require('crypto');

// ============================================================
// PROFILE
// ============================================================
router.get('/profile', async (req, res) => {
  const { data: profile } = await supabase
    .from('customer_profiles')
    .select('*, users!customer_profiles_user_id_fkey(email)')
    .eq('user_id', req.user.id)
    .is('deleted_at', null)
    .maybeSingle();

  res.json({
    profile: profile ? { ...profile, email: profile.users?.email, users: undefined } : null,
  });
});

router.post('/profile',
  body('full_name').trim().isLength({ min: 2, max: 100 }),
  body('mobile').matches(/^[6-9]\d{9}$/),
  body('address').trim().isLength({ min: 10 }),
  body('district').trim().notEmpty(),
  body('pincode').matches(/^\d{6}$/),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: existing } = await supabase.from('customer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Profile already exists.' });

    const { full_name, business_name, business_type, mobile, address, district, state, pincode, gps_lat, gps_lng, gov_id_type, gov_id_number } = req.body;

    const { data: newProfile, error } = await supabase.from('customer_profiles').insert({
      user_id: req.user.id, full_name, business_name: business_name || null,
      business_type: business_type || null, mobile, address, district,
      state: state || 'Tamil Nadu', pincode,
      gps_lat: gps_lat || null, gps_lng: gps_lng || null,
      gov_id_type: gov_id_type || null, gov_id_number: gov_id_number || null,
      verification_status: 'pending',
    }).select('id').single();

    if (error) return res.status(500).json({ error: 'Failed to create profile' });
    res.status(201).json({ message: 'Profile submitted for verification', profile_id: newProfile.id });
  }
);

router.patch('/profile', async (req, res) => {
  const { data: profile } = await supabase.from('customer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const allowed = ['mobile', 'address', 'business_name', 'gps_lat', 'gps_lng'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields' });

  updates.updated_at = new Date().toISOString();
  await supabase.from('customer_profiles').update(updates).eq('id', profile.id);
  res.json({ message: 'Profile updated' });
});

// ============================================================
// MARKETPLACE — Browse available supply
// ============================================================
router.get('/marketplace', async (req, res) => {
  const { crop, district, grade, min_qty, max_price } = req.query;

  let query = supabase
    .from('crop_listings')
    .select(`
      id, crop_name, crop_variety, supply_type, available_kg,
      estimated_yield_min_kg, estimated_yield_max_kg, estimated_yield_avg_kg,
      expected_harvest_date, grade, price_per_kg_expected, minimum_order_kg,
      confidence_level, notes,
      farmer_profiles!crop_listings_farmer_profile_id_fkey(full_name, district, state, village)
    `)
    .eq('status', 'active')
    .is('deleted_at', null)
    .eq('farmer_profiles.verification_status', 'approved')
    .is('farmer_profiles.deleted_at', null)
    .order('supply_type', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(100);

  if (crop) query = query.ilike('crop_name', `%${crop}%`);
  if (grade) query = query.eq('grade', grade);
  if (max_price) query = query.lte('price_per_kg_expected', parseFloat(max_price));

  const { data: listings, error } = await query;
  if (error) return res.status(500).json({ error: 'Failed to fetch marketplace' });

  let result = (listings || []).map(l => ({
    ...l,
    farmer_name: l.farmer_profiles?.full_name,
    district: l.farmer_profiles?.district,
    state: l.farmer_profiles?.state,
    village: l.farmer_profiles?.village,
    farmer_profiles: undefined,
  }));

  // Client-side filter for district and min_qty (PostgREST limitation with joined filters)
  if (district) result = result.filter(l => l.district === district);
  if (min_qty) result = result.filter(l => (l.available_kg >= parseFloat(min_qty)) || (l.estimated_yield_avg_kg >= parseFloat(min_qty)));

  // Attach photos
  for (const l of result) {
    const { data: photos } = await supabase
      .from('crop_photos')
      .select('photo_path, photo_type, uploaded_at')
      .eq('crop_listing_id', l.id)
      .order('uploaded_at', { ascending: false })
      .limit(3);
    l.photos = photos || [];
  }

  res.json({ listings: result, total: result.length });
});

router.get('/marketplace/meta', async (req, res) => {
  const { data: crops } = await supabase.from('crop_listings').select('crop_name').eq('status', 'active');
  const { data: farmerDistricts } = await supabase.from('farmer_profiles').select('district').eq('verification_status', 'approved');

  const uniqueCrops = [...new Set((crops || []).map(c => c.crop_name))].sort();
  const uniqueDistricts = [...new Set((farmerDistricts || []).map(d => d.district))].sort();
  res.json({ crops: uniqueCrops, districts: uniqueDistricts });
});

// ============================================================
// ORDERS
// ============================================================
router.post('/orders',
  requireApprovedCustomer,
  body('crop_name').trim().isLength({ min: 2 }),
  body('quantity_kg_requested').isFloat({ min: 1 }),
  body('delivery_location').trim().isLength({ min: 10 }),
  body('delivery_district').trim().notEmpty(),
  body('delivery_date_required').isDate(),
  body('order_type').isIn(['bulk', 'retail']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: profile } = await supabase.from('customer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
    const { crop_name, crop_variety, order_type, grade_required, quantity_kg_requested, price_per_kg_max, delivery_location, delivery_district, delivery_state, delivery_gps_lat, delivery_gps_lng, delivery_date_required, special_requirements } = req.body;

    const orderRef = `ORD-${Date.now()}-${uuidv4().substring(0, 6).toUpperCase()}`;

    const { data: order, error } = await supabase.from('orders').insert({
      order_ref: orderRef, customer_profile_id: profile.id,
      order_type, crop_name, crop_variety: crop_variety || null,
      grade_required: grade_required || 'A', quantity_kg_requested,
      price_per_kg_max: price_per_kg_max || null,
      delivery_location, delivery_district,
      delivery_state: delivery_state || 'Tamil Nadu',
      delivery_gps_lat: delivery_gps_lat || null,
      delivery_gps_lng: delivery_gps_lng || null,
      delivery_date_required, special_requirements: special_requirements || null,
      status: 'pending', payment_status: 'unpaid',
    }).select('id').single();

    if (error) return res.status(500).json({ error: 'Failed to place order' });
    res.status(201).json({
      message: 'Order placed successfully. Admin will match you with farmers.',
      order_id: order.id, order_ref: orderRef,
    });
  }
);

router.get('/orders', requireApprovedCustomer, async (req, res) => {
  const { data: profile } = await supabase.from('customer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
  if (!profile) return res.json({ orders: [] });

  const { data: orders } = await supabase
    .from('orders')
    .select('*, order_farmer_assignments(id)')
    .eq('customer_profile_id', profile.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const result = (orders || []).map(o => ({
    ...o,
    farmer_count: (o.order_farmer_assignments || []).length,
    order_farmer_assignments: undefined,
  }));
  res.json({ orders: result });
});

router.get('/orders/:id', requireApprovedCustomer, async (req, res) => {
  const { data: profile } = await supabase.from('customer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', req.params.id)
    .eq('customer_profile_id', profile.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { data: assignments } = await supabase
    .from('order_farmer_assignments')
    .select(`
      quantity_kg_assigned, price_per_kg_agreed, farmer_status,
      farmer_profiles!order_farmer_assignments_farmer_profile_id_fkey(full_name, district, village),
      crop_listings!order_farmer_assignments_crop_listing_id_fkey(crop_variety, grade, supply_type, expected_harvest_date,
        crop_photos(photo_path))
    `)
    .eq('order_id', order.id);

  const { data: logisticsRows } = await supabase.from('logistics').select('*').eq('order_id', order.id).order('created_at', { ascending: false }).limit(1);
  const logistics = logisticsRows?.[0] || null;

  const { data: payments } = await supabase.from('payments').select('payment_phase, payment_status, amount_paise, currency, paid_at').eq('order_id', order.id);

  const assignmentResult = (assignments || []).map(a => ({
    quantity_kg_assigned: a.quantity_kg_assigned,
    price_per_kg_agreed: a.price_per_kg_agreed,
    farmer_status: a.farmer_status,
    farmer_name: a.farmer_profiles?.full_name,
    district: a.farmer_profiles?.district,
    village: a.farmer_profiles?.village,
    crop_variety: a.crop_listings?.crop_variety,
    grade: a.crop_listings?.grade,
    supply_type: a.crop_listings?.supply_type,
    expected_harvest_date: a.crop_listings?.expected_harvest_date,
    transport_photo: a.crop_listings?.crop_photos?.[0]?.photo_path || null,
  }));

  res.json({
    order,
    farmer_assignments: assignmentResult,
    logistics: logistics ? {
      status: logistics.status, driver_name: logistics.driver_name,
      driver_mobile: logistics.driver_mobile, vehicle_type: logistics.vehicle_type,
      vehicle_number: logistics.vehicle_number,
      estimated_distance_km: logistics.estimated_distance_km,
      estimated_duration_min: logistics.estimated_duration_min,
      current_lat: logistics.current_lat, current_lng: logistics.current_lng,
      last_location_update: logistics.last_location_update,
      tracking_points: JSON.parse(logistics.tracking_points || '[]'),
      route_plan: JSON.parse(logistics.route_plan || '{}'),
      dispatched_at: logistics.dispatched_at, delivered_at: logistics.delivered_at,
    } : null,
    payments: payments || [],
  });
});

// ============================================================
// PAYMENTS (50% advance + 50% on delivery)
// ============================================================
router.post('/payment/create',
  requireApprovedCustomer,
  body('order_id').isInt(),
  body('payment_phase').isIn(['advance_50', 'balance_50']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: profile } = await supabase.from('customer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
    const { data: order } = await supabase.from('orders').select('*').eq('id', req.body.order_id).eq('customer_profile_id', profile.id).is('deleted_at', null).maybeSingle();
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { payment_phase } = req.body;

    if (payment_phase === 'advance_50' && order.payment_50_status === 'paid') {
      return res.status(400).json({ error: 'Advance payment already completed' });
    }
    if (payment_phase === 'balance_50') {
      if (order.payment_50_status !== 'paid') return res.status(400).json({ error: 'Advance payment must be completed first' });
      if (order.status !== 'delivered') return res.status(400).json({ error: 'Balance payment can only be made after delivery confirmation' });
      if (order.payment_50_remaining_status === 'paid') return res.status(400).json({ error: 'Balance payment already completed' });
    }

    const pricePerKg = order.price_per_kg_max || 30;
    const totalAmountInr = order.quantity_kg_fulfilled > 0
      ? order.quantity_kg_fulfilled * pricePerKg
      : order.quantity_kg_requested * pricePerKg;
    const phaseAmountInr = Math.round(totalAmountInr * 0.5);
    const amountPaise = phaseAmountInr * 100;
    const paymentRef = `PAY-${Date.now()}-${uuidv4().substring(0, 6).toUpperCase()}`;

    let gatewayOrderId = `mock_order_${uuidv4().substring(0, 8)}`;
    let useRazorpay = false;

    if (Razorpay && process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.includes('placeholder')) {
      try {
        const instance = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
        const razorpayOrder = await instance.orders.create({
          amount: amountPaise, currency: 'INR', receipt: paymentRef,
          notes: { order_id: order.id, phase: payment_phase },
        });
        gatewayOrderId = razorpayOrder.id;
        useRazorpay = true;
      } catch (e) {
        console.warn('Razorpay order creation failed, using mock:', e.message);
      }
    }

    await supabase.from('payments').insert({
      order_id: order.id, payment_ref: paymentRef, payment_phase,
      gateway_order_id: gatewayOrderId, amount_paise: amountPaise,
      currency: 'INR', payment_status: 'created',
    });

    res.json({
      payment_ref: paymentRef, gateway_order_id: gatewayOrderId,
      amount_inr: phaseAmountInr, amount_paise: amountPaise, currency: 'INR',
      razorpay_key: useRazorpay ? process.env.RAZORPAY_KEY_ID : null,
      mode: useRazorpay ? 'razorpay' : 'mock',
      note: !useRazorpay ? 'Using mock payment mode. Configure RAZORPAY_KEY_ID in .env for live payments.' : null,
    });
  }
);

router.post('/payment/verify',
  requireApprovedCustomer,
  body('payment_ref').notEmpty(),
  body('gateway_payment_id').notEmpty(),
  body('gateway_order_id').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { payment_ref, gateway_payment_id, gateway_order_id, gateway_signature } = req.body;
    const { data: payment } = await supabase.from('payments').select('*').eq('payment_ref', payment_ref).maybeSingle();
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const { data: profile } = await supabase.from('customer_profiles').select('id').eq('user_id', req.user.id).maybeSingle();
    const { data: order } = await supabase.from('orders').select('*').eq('id', payment.order_id).eq('customer_profile_id', profile.id).maybeSingle();
    if (!order) return res.status(403).json({ error: 'Access denied' });

    let verified = false;
    if (gateway_signature && process.env.RAZORPAY_KEY_SECRET && !process.env.RAZORPAY_KEY_SECRET.includes('placeholder')) {
      const body = gateway_order_id + '|' + gateway_payment_id;
      const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');
      verified = expectedSig === gateway_signature;
    } else {
      verified = gateway_order_id === payment.gateway_order_id;
    }

    if (!verified) return res.status(400).json({ error: 'Payment verification failed. Please contact support.' });

    await supabase.from('payments').update({
      payment_status: 'paid', gateway_payment_id,
      gateway_signature: gateway_signature || null,
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('payment_ref', payment_ref);

    if (payment.payment_phase === 'advance_50') {
      await supabase.from('orders').update({ payment_50_status: 'paid', payment_status: 'partial', updated_at: new Date().toISOString() }).eq('id', order.id);
    } else if (payment.payment_phase === 'balance_50') {
      await supabase.from('orders').update({ payment_50_remaining_status: 'paid', payment_status: 'paid', updated_at: new Date().toISOString() }).eq('id', order.id);
    }

    res.json({ message: 'Payment verified successfully', payment_ref, phase: payment.payment_phase });
  }
);

// Mock payment confirm (dev/demo mode)
router.post('/payment/mock-confirm',
  requireApprovedCustomer,
  body('payment_ref').notEmpty(),
  async (req, res) => {
    const { data: payment } = await supabase.from('payments').select('*').eq('payment_ref', req.body.payment_ref).maybeSingle();
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const { data: profile } = await supabase.from('customer_profiles').select('id').eq('user_id', req.user.id).maybeSingle();
    const { data: order } = await supabase.from('orders').select('*').eq('id', payment.order_id).eq('customer_profile_id', profile.id).maybeSingle();
    if (!order) return res.status(403).json({ error: 'Access denied' });

    await supabase.from('payments').update({
      payment_status: 'paid', gateway_payment_id: 'mock_pay_' + Date.now(),
      paid_at: new Date().toISOString(),
    }).eq('payment_ref', payment.payment_ref);

    if (payment.payment_phase === 'advance_50') {
      await supabase.from('orders').update({ payment_50_status: 'paid', payment_status: 'partial', updated_at: new Date().toISOString() }).eq('id', order.id);
    } else {
      await supabase.from('orders').update({ payment_50_remaining_status: 'paid', payment_status: 'paid', updated_at: new Date().toISOString() }).eq('id', order.id);
    }

    res.json({ message: 'Mock payment confirmed', phase: payment.payment_phase });
  }
);

module.exports = router;
