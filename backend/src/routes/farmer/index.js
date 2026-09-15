/**
 * Farmer Routes — All protected by authenticate + requireRole('farmer')
 * Migrated to async Supabase JS client.
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../../config/db');
const { estimateYield, getSupplyDemandGap, getDistrictForecast } = require('../../services/forecasting');
const { requireApprovedFarmer } = require('../../middleware/rbac');

// File upload config
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowed.includes(ext)) return cb(new Error('Only image files allowed'));
    cb(null, `crop_${Date.now()}_${Math.round(Math.random() * 1000)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ============================================================
// PROFILE
// ============================================================
router.get('/profile', async (req, res) => {
  const { data: profile } = await supabase
    .from('farmer_profiles')
    .select('*, users!farmer_profiles_user_id_fkey(email)')
    .eq('user_id', req.user.id)
    .is('deleted_at', null)
    .maybeSingle();

  const { data: lands } = profile
    ? await supabase.from('farm_lands').select('*').eq('farmer_profile_id', profile.id)
    : { data: [] };

  res.json({
    profile: profile ? { ...profile, email: profile.users?.email, users: undefined } : null,
    lands: lands || [],
  });
});

router.post('/profile',
  body('full_name').trim().isLength({ min: 2, max: 100 }),
  body('mobile').matches(/^[6-9]\d{9}$/),
  body('address').trim().isLength({ min: 10 }),
  body('district').trim().notEmpty(),
  body('state').trim().notEmpty(),
  body('pincode').matches(/^\d{6}$/),
  body('gov_id_type').isIn(['aadhaar', 'voter_id', 'pan', 'driving_license']),
  body('gov_id_number').trim().isLength({ min: 8 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: existing } = await supabase
      .from('farmer_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) return res.status(400).json({ error: 'Profile already exists. Use PATCH to update.' });

    const { full_name, mobile, address, village, taluk, district, state, pincode, gps_lat, gps_lng, gov_id_type, gov_id_number, bank_account, bank_ifsc, bank_name, account_holder } = req.body;

    const { data: newProfile, error } = await supabase.from('farmer_profiles').insert({
      user_id: req.user.id, full_name, mobile, address,
      village: village || null, taluk: taluk || null, district, state, pincode,
      gps_lat: gps_lat || null, gps_lng: gps_lng || null,
      gov_id_type, gov_id_number,
      bank_account: bank_account || null, bank_ifsc: bank_ifsc || null,
      bank_name: bank_name || null, account_holder: account_holder || null,
      verification_status: 'pending',
    }).select('id').single();

    if (error) return res.status(500).json({ error: 'Failed to create profile' });
    res.status(201).json({ message: 'Profile submitted for verification', profile_id: newProfile.id });
  }
);

router.patch('/profile', async (req, res) => {
  const { data: profile } = await supabase
    .from('farmer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const allowed = ['mobile', 'address', 'village', 'taluk', 'gps_lat', 'gps_lng', 'bank_account', 'bank_ifsc', 'bank_name', 'account_holder'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });

  updates.updated_at = new Date().toISOString();
  await supabase.from('farmer_profiles').update(updates).eq('id', profile.id);
  res.json({ message: 'Profile updated' });
});

// ============================================================
// LAND MANAGEMENT
// ============================================================
router.post('/lands',
  requireApprovedFarmer,
  body('land_area_acres').isFloat({ min: 0.1 }),
  body('irrigation_type').isIn(['drip', 'sprinkler', 'flood', 'rainfed', 'borewell', 'canal']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: profile } = await supabase.from('farmer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
    const { land_area_acres, irrigation_type, soil_type, survey_number, location_description, gps_lat, gps_lng } = req.body;

    const { data: newLand, error } = await supabase.from('farm_lands').insert({
      farmer_profile_id: profile.id, land_area_acres, irrigation_type,
      soil_type: soil_type || null, survey_number: survey_number || null,
      location_description: location_description || null,
      gps_lat: gps_lat || null, gps_lng: gps_lng || null,
    }).select('id').single();

    if (error) return res.status(500).json({ error: 'Failed to add land' });
    res.status(201).json({ message: 'Land added', land_id: newLand.id });
  }
);

// ============================================================
// SUPPLY / CROP LISTINGS
// ============================================================
router.get('/supply', async (req, res) => {
  const { data: profile } = await supabase.from('farmer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
  if (!profile) return res.json({ listings: [] });

  const { data: listings } = await supabase
    .from('crop_listings')
    .select('*, farm_lands(land_area_acres, irrigation_type)')
    .eq('farmer_profile_id', profile.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  // Attach photos
  const result = [];
  for (const l of (listings || [])) {
    const { data: photos } = await supabase.from('crop_photos').select('*').eq('crop_listing_id', l.id).order('uploaded_at', { ascending: false });
    result.push({ ...l, land_area_acres: l.farm_lands?.land_area_acres, irrigation_type: l.farm_lands?.irrigation_type, farm_lands: undefined, photos: photos || [] });
  }

  res.json({ listings: result });
});

router.post('/supply',
  requireApprovedFarmer,
  body('crop_name').trim().isLength({ min: 2 }),
  body('cultivated_area_acres').isFloat({ min: 0.1 }),
  body('supply_type').isIn(['current', 'expected']),
  body('grade').isIn(['A', 'B', 'C']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: profile } = await supabase.from('farmer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
    const { crop_name, crop_variety, sowing_date, expected_harvest_date, cultivated_area_acres, supply_type, grade, price_per_kg_expected, minimum_order_kg, available_kg, notes, land_id, farmer_confirmed_qty_kg } = req.body;

    const yieldEst = await estimateYield(crop_name, crop_variety, parseFloat(cultivated_area_acres));

    const { data: listing, error } = await supabase.from('crop_listings').insert({
      farmer_profile_id: profile.id, land_id: land_id || null,
      crop_name, crop_variety: crop_variety || null,
      sowing_date: sowing_date || null, expected_harvest_date: expected_harvest_date || null,
      cultivated_area_acres, supply_type,
      estimated_yield_min_kg: yieldEst.min_kg, estimated_yield_max_kg: yieldEst.max_kg,
      estimated_yield_avg_kg: yieldEst.avg_kg, confidence_level: yieldEst.confidence,
      farmer_confirmed_qty_kg: farmer_confirmed_qty_kg || null,
      available_kg: supply_type === 'current' ? (available_kg || 0) : 0,
      grade, price_per_kg_expected: price_per_kg_expected || null,
      minimum_order_kg: minimum_order_kg || 50, notes: notes || null,
      status: 'active',
    }).select('id').single();

    if (error) return res.status(500).json({ error: 'Failed to create listing' });
    res.status(201).json({ message: 'Crop listing created', listing_id: listing.id, ai_yield_estimate: yieldEst });
  }
);

router.patch('/supply/:id', requireApprovedFarmer, async (req, res) => {
  const { data: profile } = await supabase.from('farmer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
  const { data: listing } = await supabase.from('crop_listings').select('*').eq('id', req.params.id).eq('farmer_profile_id', profile.id).is('deleted_at', null).maybeSingle();
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const allowed = ['available_kg', 'price_per_kg_expected', 'minimum_order_kg', 'grade', 'status', 'notes', 'farmer_confirmed_qty_kg', 'expected_harvest_date'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields' });

  updates.updated_at = new Date().toISOString();
  await supabase.from('crop_listings').update(updates).eq('id', listing.id);
  res.json({ message: 'Listing updated' });
});

// ============================================================
// PHOTO UPLOAD
// ============================================================
router.post('/supply/:id/photos',
  requireApprovedFarmer,
  upload.array('photos', 5),
  async (req, res) => {
    const { data: profile } = await supabase.from('farmer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
    const { data: listing } = await supabase.from('crop_listings').select('*').eq('id', req.params.id).eq('farmer_profile_id', profile.id).is('deleted_at', null).maybeSingle();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No photos uploaded' });

    const photoType = req.body.photo_type || 'pre_transport';
    const validTypes = ['pre_transport', 'field', 'harvest', 'quality_check'];
    if (!validTypes.includes(photoType)) return res.status(400).json({ error: 'Invalid photo type' });

    const photoRows = req.files.map(file => ({
      crop_listing_id: listing.id, farmer_profile_id: profile.id,
      photo_path: `/uploads/${file.filename}`, photo_type: photoType,
      notes: req.body.notes || null,
      order_assignment_id: req.body.order_assignment_id || null,
    }));

    const { data: inserted } = await supabase.from('crop_photos').insert(photoRows).select('id');
    res.status(201).json({
      message: `${req.files.length} photo(s) uploaded as evidence`,
      photo_ids: (inserted || []).map(p => p.id),
      photo_type: photoType,
    });
  }
);

// ============================================================
// ORDERS (assigned to this farmer)
// ============================================================
router.get('/orders', requireApprovedFarmer, async (req, res) => {
  const { data: profile } = await supabase.from('farmer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
  if (!profile) return res.json({ assignments: [] });

  const { data: assignments } = await supabase
    .from('order_farmer_assignments')
    .select('*, orders!order_farmer_assignments_order_id_fkey(order_ref, crop_name, delivery_location, delivery_date_required, status, delivery_district, customer_profiles!orders_customer_profile_id_fkey(full_name, business_name, mobile))')
    .eq('farmer_profile_id', profile.id)
    .order('created_at', { ascending: false });

  const result = (assignments || []).map(a => ({
    ...a,
    order_ref: a.orders?.order_ref,
    crop_name: a.orders?.crop_name,
    delivery_location: a.orders?.delivery_location,
    delivery_date_required: a.orders?.delivery_date_required,
    order_status: a.orders?.status,
    delivery_district: a.orders?.delivery_district,
    customer_name: a.orders?.customer_profiles?.full_name,
    business_name: a.orders?.customer_profiles?.business_name,
    customer_mobile: a.orders?.customer_profiles?.mobile,
    orders: undefined,
  }));

  res.json({ assignments: result });
});

router.patch('/orders/:assignmentId/respond',
  requireApprovedFarmer,
  body('response').isIn(['accepted', 'rejected']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: profile } = await supabase.from('farmer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
    const { data: assignment } = await supabase.from('order_farmer_assignments').select('*').eq('id', req.params.assignmentId).eq('farmer_profile_id', profile.id).maybeSingle();

    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (assignment.farmer_status !== 'pending') return res.status(400).json({ error: 'Assignment already responded to' });

    await supabase.from('order_farmer_assignments').update({
      farmer_status: req.body.response === 'accepted' ? 'accepted' : 'rejected',
      farmer_response_notes: req.body.notes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', assignment.id);

    res.json({ message: `Assignment ${req.body.response}` });
  }
);

// ============================================================
// DEMAND FORECAST (for farmer's district)
// ============================================================
router.get('/forecast', async (req, res) => {
  const { data: profile } = await supabase.from('farmer_profiles').select('id, district, state').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
  if (!profile) return res.status(404).json({ error: 'Profile not found. Complete registration first.' });

  const crop = req.query.crop;
  const district = req.query.district || profile.district;

  try {
    if (crop) {
      res.json(await getSupplyDemandGap(crop, district, profile.state));
    } else {
      res.json({ district, forecasts: await getDistrictForecast(district, profile.state) });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute forecast' });
  }
});

router.get('/forecast/weekly', async (req, res) => {
  const { data: profile } = await supabase.from('farmer_profiles').select('id, district, state').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const district = req.query.district || profile.district;
  const crop = req.query.crop;
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateStr = sevenDaysAgo.toISOString().split('T')[0];

  let query = supabase.from('demand_history')
    .select('crop_name, sale_date, quantity_kg_sold, order_count, avg_price_per_kg, source')
    .eq('region_district', district)
    .gte('sale_date', dateStr)
    .order('sale_date', { ascending: false });

  if (crop) query = query.eq('crop_name', crop);
  const { data: history } = await query;

  const grouped = {};
  for (const row of (history || [])) {
    if (!grouped[row.crop_name]) grouped[row.crop_name] = [];
    grouped[row.crop_name].push(row);
  }

  const hasSeeded = (history || []).some(h => h.source === 'seeded');
  res.json({
    district,
    period: 'Last 7 days',
    data_note: hasSeeded ? 'Historical data includes seeded demonstration data. Live data will replace this as orders are processed.' : null,
    weekly_data: grouped,
  });
});

// Earnings summary
router.get('/earnings', requireApprovedFarmer, async (req, res) => {
  const { data: profile } = await supabase.from('farmer_profiles').select('id').eq('user_id', req.user.id).is('deleted_at', null).maybeSingle();

  const { data: settlements } = await supabase
    .from('farmer_settlements')
    .select('*, order_farmer_assignments!farmer_settlements_order_farmer_assignment_id_fkey(quantity_kg_assigned, price_per_kg_agreed, orders!order_farmer_assignments_order_id_fkey(order_ref, crop_name, delivery_date_required))')
    .eq('farmer_profile_id', profile.id)
    .order('created_at', { ascending: false });

  const result = (settlements || []).map(s => ({
    ...s,
    quantity_kg_assigned: s.order_farmer_assignments?.quantity_kg_assigned,
    price_per_kg_agreed: s.order_farmer_assignments?.price_per_kg_agreed,
    order_ref: s.order_farmer_assignments?.orders?.order_ref,
    crop_name: s.order_farmer_assignments?.orders?.crop_name,
    delivery_date_required: s.order_farmer_assignments?.orders?.delivery_date_required,
    order_farmer_assignments: undefined,
  }));

  const total = result.reduce((s, r) => s + (r.settlement_status === 'processed' ? r.amount_inr : 0), 0);
  const pending = result.reduce((s, r) => s + (r.settlement_status === 'pending' ? r.amount_inr : 0), 0);

  res.json({ settlements: result, total_earned_inr: Math.round(total), pending_inr: Math.round(pending) });
});

module.exports = router;
