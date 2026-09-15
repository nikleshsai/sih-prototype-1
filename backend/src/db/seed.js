/**
 * Database Seed Script — Supabase version
 * Seeds admin user, crop reference data, demo farmers/customers, demand history, crop listings.
 * Usage: npm run seed  (from backend/)
 * Safe to re-run — checks for existing data before inserting.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { supabase } = require('../config/db');

console.log('🌱 Seeding database...');

// ============================================================
// SEED ADMIN USER
// ============================================================
async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@farmplatform.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@Secure2024!';

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', adminEmail)
    .maybeSingle();

  if (existing) {
    console.log('✓ Admin already exists');
    return;
  }

  const hash = await bcrypt.hash(adminPassword, 12);
  const { error } = await supabase
    .from('users')
    .insert({ email: adminEmail, password_hash: hash, role: 'admin', status: 'active' });

  if (error) { console.error('Admin seed error:', error.message); return; }
  console.log('✅ Admin account created:');
  console.log(`   Email: ${adminEmail}`);
  console.log(`   Password: ${adminPassword}`);
  console.log('   ⚠️  Change this password immediately in production!');
}

// ============================================================
// SEED CROP YIELD REFERENCE
// ============================================================
async function seedCropYieldReference() {
  const { count } = await supabase
    .from('crop_yield_reference')
    .select('*', { count: 'exact', head: true });

  if (count > 0) { console.log('✓ Crop yield reference already seeded'); return; }

  const crops = [
    { crop_name: 'Tomato',     crop_variety: 'Hybrid',    min_yield_kg_per_acre: 8000,  max_yield_kg_per_acre: 14000, avg_yield_kg_per_acre: 11000, growth_days_min: 60,  growth_days_max: 90,  season: 'year_round' },
    { crop_name: 'Tomato',     crop_variety: 'Country',   min_yield_kg_per_acre: 5000,  max_yield_kg_per_acre: 9000,  avg_yield_kg_per_acre: 7000,  growth_days_min: 70,  growth_days_max: 100, season: 'year_round' },
    { crop_name: 'Onion',      crop_variety: 'Red',       min_yield_kg_per_acre: 6000,  max_yield_kg_per_acre: 10000, avg_yield_kg_per_acre: 8000,  growth_days_min: 90,  growth_days_max: 120, season: 'rabi' },
    { crop_name: 'Potato',     crop_variety: 'General',   min_yield_kg_per_acre: 7000,  max_yield_kg_per_acre: 12000, avg_yield_kg_per_acre: 9500,  growth_days_min: 75,  growth_days_max: 100, season: 'rabi' },
    { crop_name: 'Brinjal',    crop_variety: 'Hybrid',    min_yield_kg_per_acre: 7000,  max_yield_kg_per_acre: 11000, avg_yield_kg_per_acre: 9000,  growth_days_min: 55,  growth_days_max: 80,  season: 'year_round' },
    { crop_name: 'Okra',       crop_variety: 'General',   min_yield_kg_per_acre: 3500,  max_yield_kg_per_acre: 6000,  avg_yield_kg_per_acre: 4500,  growth_days_min: 45,  growth_days_max: 60,  season: 'kharif' },
    { crop_name: 'Carrot',     crop_variety: 'Ooty',      min_yield_kg_per_acre: 8000,  max_yield_kg_per_acre: 14000, avg_yield_kg_per_acre: 11000, growth_days_min: 80,  growth_days_max: 110, season: 'rabi' },
    { crop_name: 'Cabbage',    crop_variety: 'Green',     min_yield_kg_per_acre: 10000, max_yield_kg_per_acre: 18000, avg_yield_kg_per_acre: 14000, growth_days_min: 60,  growth_days_max: 90,  season: 'rabi' },
    { crop_name: 'Cauliflower',crop_variety: 'General',   min_yield_kg_per_acre: 8000,  max_yield_kg_per_acre: 13000, avg_yield_kg_per_acre: 10000, growth_days_min: 60,  growth_days_max: 90,  season: 'rabi' },
    { crop_name: 'Beans',      crop_variety: 'French',    min_yield_kg_per_acre: 3000,  max_yield_kg_per_acre: 5500,  avg_yield_kg_per_acre: 4200,  growth_days_min: 50,  growth_days_max: 70,  season: 'year_round' },
    { crop_name: 'Spinach',    crop_variety: 'General',   min_yield_kg_per_acre: 4000,  max_yield_kg_per_acre: 7000,  avg_yield_kg_per_acre: 5000,  growth_days_min: 30,  growth_days_max: 45,  season: 'year_round' },
    { crop_name: 'Chilli',     crop_variety: 'Red Dry',   min_yield_kg_per_acre: 1000,  max_yield_kg_per_acre: 2000,  avg_yield_kg_per_acre: 1400,  growth_days_min: 90,  growth_days_max: 120, season: 'kharif' },
    { crop_name: 'Banana',     crop_variety: 'Robusta',   min_yield_kg_per_acre: 12000, max_yield_kg_per_acre: 22000, avg_yield_kg_per_acre: 17000, growth_days_min: 270, growth_days_max: 330, season: 'year_round' },
    { crop_name: 'Mango',      crop_variety: 'Alphonso',  min_yield_kg_per_acre: 3000,  max_yield_kg_per_acre: 6000,  avg_yield_kg_per_acre: 4500,  growth_days_min: 120, growth_days_max: 150, season: 'zaid' },
    { crop_name: 'Paddy',      crop_variety: 'IR64',      min_yield_kg_per_acre: 1800,  max_yield_kg_per_acre: 2800,  avg_yield_kg_per_acre: 2200,  growth_days_min: 110, growth_days_max: 130, season: 'kharif' },
    { crop_name: 'Maize',      crop_variety: 'Hybrid',    min_yield_kg_per_acre: 2500,  max_yield_kg_per_acre: 4000,  avg_yield_kg_per_acre: 3200,  growth_days_min: 95,  growth_days_max: 115, season: 'kharif' },
    { crop_name: 'Groundnut',  crop_variety: 'TMV 2',     min_yield_kg_per_acre: 1200,  max_yield_kg_per_acre: 1800,  avg_yield_kg_per_acre: 1500,  growth_days_min: 100, growth_days_max: 130, season: 'kharif' },
    { crop_name: 'Sugarcane',  crop_variety: 'CO 86032',  min_yield_kg_per_acre: 40000, max_yield_kg_per_acre: 70000, avg_yield_kg_per_acre: 55000, growth_days_min: 330, growth_days_max: 365, season: 'year_round' },
  ];

  const { error } = await supabase.from('crop_yield_reference').insert(crops);
  if (error) { console.error('Crop ref seed error:', error.message); return; }
  console.log(`✅ Seeded ${crops.length} crop yield references`);
}

// ============================================================
// SEED DEMO FARMERS & CUSTOMERS
// ============================================================
async function seedDemoUsers() {
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'farmer');

  if (count > 0) { console.log('✓ Demo users already exist'); return; }

  const hash = await bcrypt.hash('Demo@1234!', 12);

  const farmers = [
    { email: 'farmer1@demo.com', name: 'Ramu Krishnan',   mobile: '9876543210', district: 'Vellore',     village: 'Katpadi',          lat: 12.9716, lng: 79.1580 },
    { email: 'farmer2@demo.com', name: 'Selvam Murugan',  mobile: '9876543211', district: 'Tirunelveli', village: 'Cheranmahadevi',    lat: 8.7139,  lng: 77.7567 },
    { email: 'farmer3@demo.com', name: 'Anbu Raj',        mobile: '9876543212', district: 'Coimbatore',  village: 'Pollachi',          lat: 10.6519, lng: 76.9973 },
    { email: 'farmer4@demo.com', name: 'Muthu Pandian',   mobile: '9876543213', district: 'Vellore',     village: 'Gudiyattam',        lat: 12.9444, lng: 78.8787 },
    { email: 'farmer5@demo.com', name: 'Lakshmi Devi',    mobile: '9876543214', district: 'Salem',       village: 'Attur',             lat: 11.5898, lng: 78.6013 },
  ];

  const customers = [
    { email: 'buyer1@demo.com', name: 'Karthik Supermarket',  biz: 'Karthik Fresh Mart',   type: 'supermarket', district: 'Chennai',    lat: 13.0827, lng: 80.2707 },
    { email: 'buyer2@demo.com', name: 'Hotel Royal Kitchen',  biz: 'Royal Palace Hotel',   type: 'hotel',       district: 'Coimbatore', lat: 11.0168, lng: 76.9558 },
    { email: 'buyer3@demo.com', name: 'Fresh Foods Processor',biz: 'TN Agri Process Ltd',  type: 'processor',   district: 'Chennai',    lat: 13.0569, lng: 80.2425 },
  ];

  for (const f of farmers) {
    const { data: userRow, error: uErr } = await supabase
      .from('users')
      .insert({ email: f.email, password_hash: hash, role: 'farmer', status: 'active' })
      .select('id')
      .single();
    if (uErr) { console.error('Farmer user error:', uErr.message); continue; }

    const { data: profileRow, error: pErr } = await supabase
      .from('farmer_profiles')
      .insert({
        user_id: userRow.id, full_name: f.name, mobile: f.mobile,
        address: `${f.village}, ${f.district}, Tamil Nadu`,
        village: f.village, district: f.district, state: 'Tamil Nadu',
        pincode: '123456', gps_lat: f.lat, gps_lng: f.lng,
        gov_id_type: 'aadhaar', gov_id_number: '1234-5678-9012',
        bank_account: '12345678901234', bank_ifsc: 'SBIN0001234',
        bank_name: 'SBI', account_holder: f.name,
        verification_status: 'approved',
      })
      .select('id')
      .single();
    if (pErr) { console.error('Farmer profile error:', pErr.message); continue; }

    await supabase.from('farm_lands').insert({
      farmer_profile_id: profileRow.id,
      land_area_acres: Math.random() * 4 + 1,
      irrigation_type: 'drip', soil_type: 'red',
      gps_lat: f.lat, gps_lng: f.lng,
    });
  }

  for (const c of customers) {
    const { data: userRow, error: uErr } = await supabase
      .from('users')
      .insert({ email: c.email, password_hash: hash, role: 'customer', status: 'active' })
      .select('id')
      .single();
    if (uErr) { console.error('Customer user error:', uErr.message); continue; }

    await supabase.from('customer_profiles').insert({
      user_id: userRow.id, full_name: c.name,
      business_name: c.biz, business_type: c.type,
      mobile: '9876543220', address: `${c.district}, Tamil Nadu`,
      district: c.district, state: 'Tamil Nadu', pincode: '600001',
      gps_lat: c.lat, gps_lng: c.lng, verification_status: 'approved',
    });
  }

  console.log(`✅ Seeded ${farmers.length} farmers, ${customers.length} customers`);
  console.log('   Demo password for all: Demo@1234!');
}

// ============================================================
// SEED DEMAND HISTORY (90 days of realistic data)
// ============================================================
async function seedDemandHistory() {
  const { count } = await supabase
    .from('demand_history')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'seeded');

  if (count > 0) { console.log('✓ Demand history already seeded'); return; }

  const crops = ['Tomato', 'Onion', 'Potato', 'Brinjal', 'Okra', 'Carrot', 'Beans'];
  const districts = ['Vellore', 'Chennai', 'Coimbatore', 'Salem', 'Tirunelveli'];
  const baseDemand = {
    Tomato:  { Vellore: 900, Chennai: 2500, Coimbatore: 1800, Salem: 700, Tirunelveli: 600 },
    Onion:   { Vellore: 600, Chennai: 1800, Coimbatore: 1200, Salem: 500, Tirunelveli: 450 },
    Potato:  { Vellore: 400, Chennai: 1500, Coimbatore: 900,  Salem: 350, Tirunelveli: 300 },
    Brinjal: { Vellore: 350, Chennai: 800,  Coimbatore: 600,  Salem: 280, Tirunelveli: 220 },
    Okra:    { Vellore: 200, Chennai: 600,  Coimbatore: 400,  Salem: 180, Tirunelveli: 150 },
    Carrot:  { Vellore: 150, Chennai: 700,  Coimbatore: 500,  Salem: 130, Tirunelveli: 100 },
    Beans:   { Vellore: 180, Chennai: 550,  Coimbatore: 380,  Salem: 150, Tirunelveli: 120 },
  };
  const dowFactor = [0.9, 0.95, 1.0, 1.0, 1.05, 1.2, 1.15];

  const today = new Date();
  const rows = [];

  for (let daysAgo = 90; daysAgo >= 0; daysAgo--) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = date.toISOString().split('T')[0];
    const dow = date.getDay();

    for (const crop of crops) {
      for (const district of districts) {
        const base = baseDemand[crop][district];
        const trendFactor = 1 + (90 - daysAgo) * 0.001;
        const noise = 0.85 + Math.random() * 0.3;
        const qty = Math.round(base * dowFactor[dow] * trendFactor * noise);
        const price = Math.round((20 + Math.random() * 30) * 100) / 100;
        rows.push({
          crop_name: crop, region_district: district,
          region_state: 'Tamil Nadu', sale_date: dateStr,
          quantity_kg_sold: qty, order_count: Math.max(1, Math.round(qty / 200)),
          avg_price_per_kg: price, source: 'seeded',
        });
      }
    }
  }

  // Batch insert in chunks of 500 to avoid payload limits
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('demand_history').upsert(chunk, {
      onConflict: 'crop_name,region_district,sale_date',
      ignoreDuplicates: true,
    });
    if (error) console.warn(`Demand history chunk error: ${error.message}`);
  }

  console.log(`✅ Seeded ${rows.length} demand history records`);
  console.log('   ⚠️  This is seeded historical data for demonstration purposes');
}

// ============================================================
// SEED CROP LISTINGS
// ============================================================
async function seedCropListings() {
  const { count } = await supabase
    .from('crop_listings')
    .select('*', { count: 'exact', head: true });

  if (count > 0) { console.log('✓ Crop listings already seeded'); return; }

  const { data: farmers } = await supabase
    .from('farmer_profiles')
    .select('id, district, farm_lands(id, land_area_acres)')
    .not('farm_lands', 'is', null);

  if (!farmers || !farmers.length) { console.log('⚠️  No farmers found — skipping crop listings'); return; }

  const { data: yieldRefs } = await supabase.from('crop_yield_reference').select('*');
  const yieldMap = {};
  if (yieldRefs) yieldRefs.forEach(r => { if (!yieldMap[r.crop_name]) yieldMap[r.crop_name] = r; });

  const templates = [
    { crop: 'Tomato',  variety: 'Hybrid',  grade: 'A', price: 28, min_order: 100, type: 'current',  available: 2500 },
    { crop: 'Onion',   variety: 'Red',     grade: 'A', price: 22, min_order: 200, type: 'current',  available: 1800 },
    { crop: 'Tomato',  variety: 'Hybrid',  grade: 'B', price: 20, min_order: 100, type: 'expected', available: 0 },
    { crop: 'Brinjal', variety: 'Hybrid',  grade: 'A', price: 18, min_order: 50,  type: 'current',  available: 800 },
    { crop: 'Okra',    variety: 'General', grade: 'A', price: 35, min_order: 50,  type: 'expected', available: 0 },
  ];

  const futureDate = (days) => {
    const d = new Date(); d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  for (let i = 0; i < farmers.length; i++) {
    const f = farmers[i];
    const land = f.farm_lands?.[0];
    if (!land) continue;
    const l = templates[i % templates.length];
    const area = Math.min(land.land_area_acres, 3);
    const ref = yieldMap[l.crop];
    const minYield = ref ? ref.min_yield_kg_per_acre * area : 3000;
    const maxYield = ref ? ref.max_yield_kg_per_acre * area : 8000;
    const avgYield = ref ? ref.avg_yield_kg_per_acre * area : 5000;

    await supabase.from('crop_listings').insert({
      farmer_profile_id: f.id, land_id: land.id,
      crop_name: l.crop, crop_variety: l.variety,
      sowing_date: futureDate(-30), expected_harvest_date: futureDate(20 + i * 10),
      cultivated_area_acres: area, supply_type: l.type,
      estimated_yield_min_kg: minYield, estimated_yield_max_kg: maxYield,
      estimated_yield_avg_kg: avgYield, confidence_level: 'medium',
      available_kg: l.type === 'current' ? l.available : 0,
      grade: l.grade, price_per_kg_expected: l.price, minimum_order_kg: l.min_order,
      status: 'active',
    });
  }

  console.log(`✅ Seeded ${farmers.length} crop listings`);
}

// ============================================================
// RUN ALL SEEDS
// ============================================================
async function main() {
  try {
    await seedAdmin();
    await seedCropYieldReference();
    await seedDemoUsers();
    await seedDemandHistory();
    await seedCropListings();
    console.log('\n🎉 Database seeding complete!\n');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

main();
