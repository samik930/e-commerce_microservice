-- ===================================================
-- PostgreSQL Schema for Microservices (Supabase Ready)
-- ===================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------
-- 1. ENUM TYPES
-- ---------------------------------------------------
CREATE TYPE order_status_enum AS ENUM ('Placed', 'Processing', 'Shipped', 'Delivered', 'Cancelled');

-- ---------------------------------------------------
-- 2. AUTOMATIC UPDATED_AT TRIGGER FUNCTION
-- ---------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW; 
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------
-- 3. USERS TABLE (User Service)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Index for fast user authentication lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);


-- ---------------------------------------------------
-- 4. PRODUCTS TABLE (Product Service)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
    attributes JSONB DEFAULT '{}'::jsonb, -- Flexible specs (brand, color, size, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- GIN Index on JSONB attributes for lightning-fast dynamic filtering
CREATE INDEX IF NOT EXISTS idx_products_attributes ON products USING GIN (attributes);


-- ---------------------------------------------------
-- 5. ORDERS TABLE (Order Service)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
    status order_status_enum NOT NULL DEFAULT 'Placed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Index for fetching orders per user efficiently
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);


-- ---------------------------------------------------
-- 6. ORDER ITEMS TABLE (Order Service)
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);


-- ---------------------------------------------------
-- 7. SEED INITIAL SAMPLE DATA
-- ---------------------------------------------------
INSERT INTO products (name, description, price, stock, attributes)
VALUES 
('Wireless Gaming Mouse', 'High DPI RGB gaming mouse', 49.99, 100, '{"brand": "Logitech", "color": "Black", "dpi": 16000}'),
('Mechanical Keyboard', 'RGB Mechanical Gaming Keyboard with Red Switches', 89.99, 50, '{"brand": "Corsair", "switch_type": "Red", "wireless": false}'),
('UltraWide Monitor 34"', '144Hz WQHD Curved Gaming Monitor', 499.99, 20, '{"resolution": "3440x1440", "refresh_rate": "144Hz"}')
ON CONFLICT DO NOTHING;
