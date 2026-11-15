# 🛒 Distributed E-Commerce Microservices Platform

[![Node.js](https://img.shields.io/badge/Node.js-18.x%20%7C%2020.x-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Upstash Redis](https://img.shields.io/badge/Upstash_Redis-Serverless_Cache-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://upstash.com/)
[![Docker](https://img.shields.io/badge/Docker_Compose-Multi--Container-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

A production-ready, distributed e-commerce microservices platform built with **Node.js, Express, React (Vite), PostgreSQL, and Upstash Redis**, fully containerized using **Docker & Docker Compose**.

The system adopts distributed systems patterns including an **API Gateway with Reverse Proxy Routing**, **Stateful Token Revocation / Blacklisting via Redis**, **Distributed Sliding-Window Rate Limiting**, **Cache-Aside Product Catalog Read Optimizations**, **ACID-Compliant Multi-Item Checkout Transactions**, and a **Cryptographic Mock Razorpay Payment Gateway**.

---

## 📑 Table of Contents

- [System Architecture](#system-architecture)
- [Key Features & Engineering Highlights](#key-features--engineering-highlights)
- [Service Registry & Port Allocation](#service-registry--port-allocation)
- [Database Schema & Persistence](#database-schema--persistence)
- [Core API Reference](#core-api-reference)
  - [Authentication Service (`/api/auth`)](#authentication-service-apiauth)
  - [Product Catalog Service (`/api/products`)](#product-catalog-service-apiproducts)
  - [Cart & Order Service (`/api/cart` & `/api/orders`)](#cart--order-service-apicart--apiorders)
  - [Payment Service (`/api/payments`)](#payment-service-apipayments)
- [Project Directory Layout](#project-directory-layout)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Configuration](#environment-configuration)
  - [Running with Docker Compose](#running-with-docker-compose)
  - [Running Services Locally (Optional)](#running-services-locally-optional)
- [Security Architecture](#security-architecture)
- [Author & License](#author)

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer["🖥️ Frontend Client"]
        Client["React 18 SPA (Vite)<br/>Port: 5173"]
    end

    subgraph EdgeLayer["⚖️ Public Edge (:5050)"]
        LB["Nginx Load Balancer<br/>Least-Connections • SSL • Diagnostic Headers"]
    end

    subgraph GatewayCluster["🛡️ API Gateway Cluster (Replicas)"]
        GW1["API Gateway Replica 1 (:5000)<br/>Reverse Proxy • Cookie JWT Auth"]
        GW2["API Gateway Replica 2 (:5000)<br/>Reverse Proxy • Cookie JWT Auth"]
    end

    subgraph CacheLayer["⚡ Distributed Cache & Session Store"]
        Redis[("Upstash Redis<br/>• Shared Sliding-Window Rate Limits<br/>• Token Blacklist (bl:token)<br/>• Product Cache (products:all)<br/>• Active Carts (cart:userId)")]
    end

    subgraph ServicesLayer["⚙️ Core Microservices"]
        UserService["User Service (:5001)<br/>Bcrypt • JWT • Cookie Management"]
        ProductService["Product Service (:5002)<br/>Cache-Aside • Stock Reservation"]
        OrderService["Order Service (:5003)<br/>ACID Transactions • Cart Checkout"]
        PaymentService["Payment Service (:5004)<br/>Mock Razorpay • HMAC Verification"]
    end

    subgraph DatabaseLayer["🗄️ Relational Persistence (:5432)"]
        Postgres[("PostgreSQL 16 Engine<br/>• users<br/>• products<br/>• orders<br/>• order_items<br/>• payments")]
    end

    %% Client Traffic
    Client -->|"HTTP / Credentials (Cookies)"| LB

    %% Load Balancer to Gateway Replicas
    LB -->|"least_conn"| GW1
    LB -->|"least_conn"| GW2

    %% Gateways to Shared Redis
    GW1 <-->|"Sliding Window & Blacklist"| Redis
    GW2 <-->|"Sliding Window & Blacklist"| Redis

    %% Gateways Forwarding to Microservices
    GW1 & GW2 -->|"/api/auth/*"| UserService
    GW1 & GW2 -->|"/api/products/*"| ProductService
    GW1 & GW2 -->|"/api/orders/* & /api/cart/*"| OrderService
    GW1 & GW2 -->|"/api/payments/*"| PaymentService
    Gateway -->|"/api/payments/*"| PaymentService

    %% Microservices to Redis
    UserService <-->|"Store Revoked Tokens"| Redis
    ProductService <-->|"Cache-Aside (TTL: 30s)"| Redis
    OrderService <-->|"Session Carts (TTL: 7d)"| Redis

    %% Microservices to DB
    UserService --> Postgres
    ProductService --> Postgres
    OrderService --> Postgres
    PaymentService --> Postgres

    %% Payment to Order sync
    PaymentService -.->|"Status & Receipt Sync"| OrderService
```

---

## ✨ Key Features & Engineering Highlights

### 1. 🛡️ Reverse Proxy API Gateway & Centralized Security
- **Unified Entry Point (`:5000`)**: Routes all incoming traffic to isolated internal microservices via `http-proxy-middleware`.
- **HttpOnly Cookie Authentication**: Automatically parses credentials from browser cookies, verifies JWT tokens, and transparently strips and injects authenticated user identities (`x-user-id`, `x-user-email`) into downstream service requests.
- **Header Spoofing Prevention**: Actively sanitizes inbound `x-user-id` and `x-user-email` headers to prevent identity-spoofing attacks from untrusted clients.
- **Distributed Token Blacklisting**: Intercepts logged-out tokens stored in Redis (`bl:<token>`) with remaining TTL to ensure immediate revocation.
- **Sliding-Window Rate Limiting**:
  - **Auth Endpoints (`/api/auth`)**: Restricted to **10 requests / minute** per IP to defend against credential stuffing and brute-force attacks.
  - **Resource Endpoints (`/api/products`, `/api/orders`, `/api/cart`, `/api/payments`)**: Capped at **100 requests / minute** per IP.
  - **Fail-Open Strategy**: If Redis experiences network interruptions, the limiter gracefully fails open to protect platform availability.

### 2. 📦 Transactional Order Management (ACID)
- **Atomic Checkout**: Orders and line items are placed within atomic PostgreSQL transactions (`BEGIN` $\rightarrow$ `COMMIT` $\rightarrow$ `ROLLBACK`), guaranteeing zero partial state corruption.
- **Automated Cart Eviction**: Seamlessly evicts the user's active Redis shopping cart (`cart:{userId}`) upon successful order placement.
- **Data Isolation**: Ensures strict tenant boundaries; users can only query, inspect, and update their own orders.

### 3. ⚡ High-Throughput Cache-Aside Strategy
- **Catalog Performance**: High-traffic product listings are cached in Upstash Redis (`products:all`) with TTL expiration, bypassing database queries and drastically lowering read latency.
- **Fast Cart Operations**: Shopping cart items are held in memory-speed Redis keys (`cart:{userId}`) with a 7-day TTL, minimizing relational database writes during active user shopping sessions.

### 4. 💳 Mock Razorpay Payment Gateway & Cryptographic Integrity
- **Realistic SDK Simulation**: Emulates the Razorpay order lifecycle (paise conversion, order IDs, receipt generation, and transaction tokens).
- **HMAC-SHA256 Signatures**: Generates and verifies cryptographic signatures (`razorpay_order_id|razorpay_payment_id`) against a mock secret.
- **Simulated Scenarios**: Supports testing both successful payment captures and simulated failure scenarios directly from the frontend UI.

### 5. 🐳 Containerized Orchestration
- **One-Command Environment**: Orchestrates the API Gateway, 4 backend services, the React frontend, and PostgreSQL via `docker-compose.yml`.
- **Health-Check Dependency**: Microservices enforce `pg_isready` on the PostgreSQL container before boot, eliminating database connection race conditions.

---

## 🔌 Service Registry & Port Allocation

| Service | Port | Tech Stack | Responsibility |
| :--- | :---: | :--- | :--- |
| **Nginx Load Balancer** | `5050` | Nginx Alpine | Least-Connections Traffic Distribution, SSL Termination, Reverse Proxy |
| **API Gateway Cluster** | `5000` (internal) | Node.js, Express, Redis | Scalable Replicas, Shared Rate Limiting, Cookie Auth, Header Sanitization |
| **User Service** | `5001` | Node.js, Express, PostgreSQL | Registration, Login, HttpOnly Cookies, Token Revocation |
| **Product Service** | `5002` | Node.js, Express, Redis, PostgreSQL | Product Catalog, JSONB Attributes, Cache-Aside Layer |
| **Order Service** | `5003` | Node.js, Express, PostgreSQL, Redis | ACID Multi-Item Orders, Redis Cart Management |
| **Payment Service** | `5004` | Node.js, Express, PostgreSQL | Mock Razorpay Gateway, HMAC Signatures, Payment History |
| **Frontend Client** | `5173` | React 18, Vite, React Router | Modern Responsive E-Commerce Single Page Application |
| **PostgreSQL Database** | `5432` | PostgreSQL 16 Alpine | Primary Relational Persistence (Users, Products, Orders, Payments) |

---

## 🗄️ Database Schema & Persistence

The platform utilizes **PostgreSQL 16** with Supabase compatibility, UUID keys, and automatic triggers:

```
┌─────────────────────────┐       ┌─────────────────────────┐
│          users          │       │        products         │
├─────────────────────────┤       ├─────────────────────────┤
│ id (UUID, PK)           │       │ id (UUID, PK)           │
│ name (VARCHAR)          │       │ name (VARCHAR)          │
│ email (VARCHAR, UNIQUE) │       │ description (TEXT)      │
│ password (HASH)         │       │ price (NUMERIC)         │
│ created_at / updated_at │       │ stock (INT)             │
└───────────┬─────────────┘       │ attributes (JSONB, GIN) │
            │ 1                   │ created_at / updated_at │
            │                     └─────────────────────────┘
            │ N
┌───────────▼─────────────┐       ┌─────────────────────────┐
│         orders          │ 1   N │       order_items       │
├─────────────────────────┤◄──────├─────────────────────────┤
│ id (UUID, PK)           │       │ id (UUID, PK)           │
│ user_id (UUID, FK)      │       │ order_id (UUID, FK)     │
│ total (NUMERIC)         │       │ product_id (UUID, FK)   │
│ status (ENUM)           │       │ product_name (VARCHAR)  │
│ created_at / updated_at │       │ quantity (INT)          │
└───────────┬─────────────┘       │ price (NUMERIC)         │
            │ 1                   └─────────────────────────┘
            │
            │ N
┌───────────▼─────────────┐
│        payments         │
├─────────────────────────┤
│ id (UUID, PK)           │
│ order_id (UUID, FK)     │
│ user_id (UUID, FK)      │
│ amount (NUMERIC)        │
│ currency (VARCHAR)      │
│ status (VARCHAR)        │
│ transaction_id (VARCHAR)│
│ gateway_order_id (STR)  │
│ payment_method (VARCHAR)│
│ created_at / updated_at │
└─────────────────────────┘
```

- **GIN Indexes**: `products.attributes` uses a PostgreSQL GIN index for high-speed dynamic filtering on arbitrary JSONB specifications.
- **Triggers**: Automated `update_updated_at_column()` functions keep timestamps synchronized across updates.
- **Data Integrity**: Foreign key constraints cascade deletes where appropriate (`orders` $\rightarrow$ `users`, `order_items` $\rightarrow$ `orders`).

---

## 📡 Core API Reference

All requests pass through the **API Gateway** on `http://localhost:5000/api`.

### 🔐 Authentication Service (`/api/auth`)
*Rate Limited: 10 requests / min*

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/auth/register` | Register new user account; returns HttpOnly auth cookie | No |
| `POST` | `/api/auth/login` | Validate credentials; sets HttpOnly session cookie | No |
| `POST` | `/api/auth/logout` | Revokes token via Redis blacklist and clears cookie | Cookie |
| `GET` | `/api/auth/me` | Fetch currently logged-in user profile | Cookie |

---

### 🛍️ Product Catalog Service (`/api/products`)
*Rate Limited: 100 requests / min*

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/products` | Retrieve all products (cached via Redis Cache-Aside) | Yes (Cookie) |
| `GET` | `/api/products/:id` | Fetch details & stock for a single product | Yes (Cookie) |
| `POST` | `/api/products/reserve` | Atomically reserve/deduct stock for checkout (`{ items: [] }`) | Yes (Cookie / Service) |
| `POST` | `/api/products/release` | Release/restore reserved stock on cancellation (`{ items: [] }`) | Yes (Cookie / Service) |

---

### 🛒 Cart & Order Service (`/api/cart` & `/api/orders`)
*Rate Limited: 100 requests / min*

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/cart` | Get current user's active shopping cart from Redis | Yes (Cookie) |
| `POST` | `/api/cart` | Sync/replace cart item list in Redis (`{ items: [] }`) | Yes (Cookie) |
| `DELETE` | `/api/cart` | Clear current user's active cart in Redis | Yes (Cookie) |
| `GET` | `/api/orders` | Fetch list of all orders placed by authenticated user | Yes (Cookie) |
| `POST` | `/api/orders` | Create order with ACID transaction & clear Redis cart | Yes (Cookie) |
| `GET` | `/api/orders/:id` | Fetch details & line items of a specific order | Yes (Cookie) |
| `PATCH` | `/api/orders/:id/status` | Update order status (`Placed`, `Shipped`, etc.) | Yes (Cookie) |

---

### 💳 Payment Service (`/api/payments`)
*Rate Limited: 100 requests / min*

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/payments/initiate` | Create payment intent & mock Razorpay order (`{ orderId }`) | Yes (Cookie) |
| `POST` | `/api/payments/process` | Simulate payment (`simulateStatus: "success" \| "failure"`) | Yes (Cookie) |
| `GET` | `/api/payments/order/:orderId` | Get payment status and details for an order | Yes (Cookie) |
| `GET` | `/api/payments/history` | List complete payment transaction history for user | Yes (Cookie) |

---

## 📁 Project Directory Layout

```text
├── nginx/                  # Edge Nginx Load Balancer (:5000 public entry point)
│   └── nginx.conf          # Least-connections upstream routing & diagnostic headers
│
├── api-gateway/            # Scalable API Gateway Cluster (Replicas)
│   ├── src/
│   │   ├── config/         # Microservice endpoints & Upstash Redis client
│   │   ├── middleware/     # Cookie JWT verification & Redis sliding-window limiter
│   │   ├── routes/         # Reverse proxy route definitions
│   │   └── app.js          # Express initialization & CORS configuration
│   └── Dockerfile
│
├── frontend/               # React 18 + Vite client (:5173)
│   ├── src/
│   │   ├── App.jsx         # Core app logic (Auth, Cart, Products, Orders, Payments)
│   │   ├── App.css         # Component styling
│   │   └── main.jsx        # React root entry
│   └── Dockerfile
│
├── user-service/           # User authentication microservice (:5001)
│   ├── src/
│   │   ├── config/         # PostgreSQL pool & Upstash Redis client
│   │   ├── controllers/    # Bcrypt hashing, JWT issuance & token blacklist logic
│   │   ├── routes/         # /api/auth routes
│   │   └── app.js
│   └── Dockerfile
│
├── product-service/        # Product catalog microservice (:5002)
│   ├── src/
│   │   ├── config/         # PostgreSQL pool & Upstash Redis client
│   │   ├── controllers/    # Cache-Aside product querying (TTL: 30s)
│   │   ├── routes/         # /api/products routes
│   │   └── app.js
│   └── Dockerfile
│
├── order-service/          # Order & Cart microservice (:5003)
│   ├── src/
│   │   ├── config/         # PostgreSQL pool & Upstash Redis client
│   │   ├── controllers/    # ACID transactional checkout & Redis cart store
│   │   ├── routes/         # /api/orders and /api/cart routes
│   │   └── app.js
│   └── Dockerfile
│
├── payment-service/        # Payment processing microservice (:5004)
│   ├── src/
│   │   ├── config/         # PostgreSQL pool
│   │   ├── controllers/    # Payment initiation, simulation & query logic
│   │   ├── routes/         # /api/payments routes
│   │   ├── services/       # Mock Razorpay SDK emulator & HMAC signer
│   │   └── app.js
│   └── Dockerfile
│
├── docker-compose.yml      # Multi-container network, volume & health check orchestration
├── schema.sql              # Database DDL schema, UUID extension, triggers & seeds
├── .env.example            # Environment variables template
├── PRE_KAFKA_PREREQUISITES.md # Architectural rationale & EDA transition guide
└── README.md               # Documentation
```

---

## 🚀 Getting Started

### Prerequisites
- [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/)
- [Node.js](https://nodejs.org/) (v18 or higher, optional for running bare-metal)
- An [Upstash Redis](https://upstash.com/) account (Free tier is sufficient)

---

### Environment Configuration

1. Copy `.env.example` to create `.env` in the root directory:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and fill in your credentials:
   ```env
   # PostgreSQL Settings
   POSTGRES_DB=postgres
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=your_secure_postgres_password
   DATABASE_URL=postgresql://postgres:your_secure_postgres_password@postgres:5432/postgres

   # JWT Secret Key
   JWT_SECRET=your_super_secret_jwt_key_here

   # Upstash Redis Credentials
   UPSTASH_REDIS_REST_URL=https://your-upstash-redis-url.upstash.io
   UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token_here

   # Frontend Client Configuration
   VITE_API_BASE_URL=http://localhost:5000/api
   ```

---

### Running with Docker Compose

Launch the entire ecosystem with a single command:

```bash
docker compose up --build
```

**What Docker Compose does:**
1. Spins up **PostgreSQL 16** on `:5432` and executes `schema.sql` on initialization.
2. Waits for PostgreSQL to pass the health check (`pg_isready`).
3. Launches **User**, **Product**, **Order**, and **Payment** services.
4. Starts the **API Gateway** on port `5000`.
5. Starts the **React 18 Frontend** on port `5173`.

To run in the background (detached mode):
```bash
docker compose up -d
```

To inspect container logs:
```bash
docker compose logs -f
```

To stop all containers and networks:
```bash
docker compose down
```

---

### Running Services Locally (Optional)

If running without Docker, start each service individually:

1. Ensure a PostgreSQL instance is running with `schema.sql` applied.
2. In each microservice directory (`api-gateway`, `user-service`, `product-service`, `order-service`, `payment-service`, `frontend`), create a `.env` file pointing to your database and Redis.
3. Install dependencies and start:
   ```bash
   # In each backend directory
   npm install
   npm run dev   # or npm start

   # In frontend directory
   npm install
   npm run dev
   ```

---

## 🛡️ Security Architecture

| Security Mechanism | Implementation | Benefit |
| :--- | :--- | :--- |
| **HttpOnly Cookies** | Tokens stored in `token` cookie with `httpOnly: true` and `sameSite: 'lax'` | Completely mitigates Cross-Site Scripting (XSS) token theft. |
| **Token Revocation** | Stored in Redis (`bl:<token>`) with matching TTL upon logout | Prevents replay attacks using valid unexpired JWTs after logout. |
| **Header Stripping** | Inbound `x-user-id` and `x-user-email` headers removed at Gateway | Eliminates header injection and impersonation attacks. |
| **Distributed Rate Limiting** | Upstash Redis sliding window with IP-based counters | Mitigates DDoS and brute-force password guessing. |
| **Fail-Open Fault Tolerance** | Rate limiter fails open upon cache network blips | Ensures business uptime during transient third-party failures. |
| **Cryptographic Signatures** | Mock Razorpay HMAC-SHA256 digest validation | Prevents manipulation of transaction values and order outcomes. |
| **ACID Transactions** | Connection-level `BEGIN` / `COMMIT` / `ROLLBACK` blocks | Prevents partial order records and data desynchronization. |

---

## 👨‍💻 Author

**Samik Podder**
- **GitHub**: [@samik930](https://github.com/samik930)
- **LinkedIn**: [Samik Podder](https://www.linkedin.com/in/samik-podder-130165402/)
- **Email**: [samikpodder396@gmail.com](mailto:samikpodder396@gmail.com)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
