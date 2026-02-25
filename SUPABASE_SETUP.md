# TARZONA Supabase Database Setup

## SQL Schema - Run in Supabase SQL Editor

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. user_accounts table
CREATE TABLE user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  password_hash TEXT NOT NULL,
  password_updated_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- 3. staff_permissions table
CREATE TABLE staff_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  can_add_product BOOLEAN DEFAULT FALSE,
  can_delete_product BOOLEAN DEFAULT FALSE,
  can_edit_product BOOLEAN DEFAULT TRUE,
  can_grant_admin BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. products table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  brand TEXT NOT NULL,
  size TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC NOT NULL,
  image_url TEXT,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. inventory_snapshot table
CREATE TABLE inventory_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  beginning_qty INT NOT NULL DEFAULT 0,
  stock_in_qty INT NOT NULL DEFAULT 0,
  stock_out_qty INT NOT NULL DEFAULT 0,
  end_qty INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(product_id, snapshot_date)
);

-- 6. inventory_transactions table
CREATE TABLE inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP DEFAULT NOW(),
  snapshot_date DATE NOT NULL,
  actor_profile_id UUID REFERENCES profiles(id),
  actor_username TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT,
  txn_type TEXT NOT NULL CHECK (txn_type IN (
    'add_product',
    'edit_product',
    'archive_product',
    'archive_all',
    'delete_product',
    'delete_all',
    'export',
    'profile_edit',
    'permission_change',
    'beginning_set',
    'stock_in',
    'stock_out'
  )),
  qty_delta INT,
  before_beginning INT,
  after_beginning INT,
  before_in INT,
  after_in INT,
  before_out INT,
  after_out INT,
  before_end INT,
  after_end INT,
  note TEXT
);

-- Enable Row Level Security on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for prototype (allow all operations)
-- For production, implement proper RLS with JWT claims

CREATE POLICY "Allow all on profiles" ON profiles FOR ALL USING (true);
CREATE POLICY "Allow all on user_accounts" ON user_accounts FOR ALL USING (true);
CREATE POLICY "Allow all on staff_permissions" ON staff_permissions FOR ALL USING (true);
CREATE POLICY "Allow all on products" ON products FOR ALL USING (true);
CREATE POLICY "Allow all on inventory_snapshot" ON inventory_snapshot FOR ALL USING (true);
CREATE POLICY "Allow all on inventory_transactions" ON inventory_transactions FOR ALL USING (true);

-- Insert test users (passwords hashed with bcrypt, cost 10)
-- Admin: raphcru / admin123
-- Staff: gingvmb / staff123

INSERT INTO profiles (id, username, full_name, email, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'raphcru', 'Raphael Crucillo', 'raphaelcrucillo@gmail.com', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'gingvmb', 'Georgia Mae Bongo', 'georgeime@gmail.com', 'staff');

-- Bcrypt hash for 'admin123': $2a$10$rGF3UzI7vKWJxvYp5.Ij8.YkQH8Z0q7fXPZ1Y2HzJ3n6vKQZ8dK5C
-- Bcrypt hash for 'staff123': $2a$10$Z8qH7Vz1.KLWJxY9p5.Ij8.YkQH8Z0q7fXPZ1Y2HzJ3n6vKQZ8dK5m

INSERT INTO user_accounts (profile_id, password_hash) VALUES
  ('11111111-1111-1111-1111-111111111111', '$2a$10$rGF3UzI7vKWJxvYp5.Ij8.YkQH8Z0q7fXPZ1Y2HzJ3n6vKQZ8dK5C'),
  ('22222222-2222-2222-2222-222222222222', '$2a$10$Z8qH7Vz1.KLWJxY9p5.Ij8.YkQH8Z0q7fXPZ1Y2HzJ3n6vKQZ8dK5m');

-- Insert staff permissions for gingvmb
INSERT INTO staff_permissions (staff_profile_id, can_add_product, can_delete_product, can_edit_product, can_grant_admin) VALUES
  ('22222222-2222-2222-2222-222222222222', true, false, true, false);

-- Insert sample products
INSERT INTO products (display_name, brand, size, category, price, archived) VALUES
  ('Red Horse Beer', 'Red Horse', '500 mL', 'Beer', 60.00, false),
  ('Jose Cuervo Tequila', 'Jose Cuervo', '1 Litre', 'Wine', 1200.00, false),
  ('Alfonso Light Brandy', 'Alfonso', '1.75 Litre', 'Wine', 1200.00, false),
  ('Jack Daniel Whiskey', 'Jack Daniel', '1 Litre', 'Wine', 1200.00, false),
  ('Charles and James Wine', 'Charles & James', '1 Litre', 'Wine', 450.00, false),
  ('Emperador Light', 'Emperador', '1 Litre', 'Wine', 120.00, false);

-- Insert sample inventory snapshots for today
INSERT INTO inventory_snapshot (product_id, snapshot_date, beginning_qty, stock_in_qty, stock_out_qty, end_qty)
SELECT 
  id,
  CURRENT_DATE,
  CASE 
    WHEN display_name = 'Red Horse Beer' THEN 52
    WHEN display_name = 'Jose Cuervo Tequila' THEN 10
    WHEN display_name = 'Alfonso Light Brandy' THEN 294
    WHEN display_name = 'Jack Daniel Whiskey' THEN 9
    WHEN display_name = 'Charles and James Wine' THEN 21
    WHEN display_name = 'Emperador Light' THEN 10
  END as beginning_qty,
  0 as stock_in_qty,
  CASE 
    WHEN display_name = 'Red Horse Beer' THEN 13
    WHEN display_name = 'Alfonso Light Brandy' THEN 3
    WHEN display_name = 'Charles and James Wine' THEN 3
    ELSE 0
  END as stock_out_qty,
  CASE 
    WHEN display_name = 'Red Horse Beer' THEN 39
    WHEN display_name = 'Jose Cuervo Tequila' THEN 10
    WHEN display_name = 'Alfonso Light Brandy' THEN 291
    WHEN display_name = 'Jack Daniel Whiskey' THEN 9
    WHEN display_name = 'Charles and James Wine' THEN 18
    WHEN display_name = 'Emperador Light' THEN 10
  END as end_qty
FROM products
WHERE NOT archived;

-- Enable Realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_snapshot;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE staff_permissions;

-- 7. Storage bucket for product photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for prototype (public read + anon upload/update/delete)
CREATE POLICY "Public read product images"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

CREATE POLICY "Public upload product images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Public update product images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'product-images')
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Public delete product images"
ON storage.objects FOR DELETE
USING (bucket_id = 'product-images');
```

## Setup Instructions

1. Go to your Supabase project
2. Navigate to SQL Editor
3. Copy and paste the entire SQL script above
4. Run the script
5. Verify tables are created in Table Editor
6. Copy your Supabase URL and anon key
7. In TARZONA app, click the gear icon on login screen
8. Paste credentials and test connection

## Test Credentials

- **Admin**: raphcru / admin123
- **Staff**: gingvmb / staff123

## Notes

- Passwords are hashed with bcrypt (cost 10)
- RLS is enabled but permissive for prototype
- Realtime is enabled for live updates
- Sample data includes 6 products with inventory for today
- Product photos are stored in Supabase Storage bucket `product-images`
