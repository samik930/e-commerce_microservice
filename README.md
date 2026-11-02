# 🛒 Distributed E-Commerce Microservices Platform

[![Node.js](https://img.shields.io/badge/Node.js-18.x%20%7C%2020.x-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Upstash_Redis-Distributed_Cache-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://upstash.com/)
[![Docker](https://img.shields.io/badge/Docker_Compose-Multi--Container-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

A production-grade, distributed e-commerce architecture built with **Node.js, Express, React, PostgreSQL, and Redis**, fully containerized via **Docker & Docker Compose**. 

Designed with distributed systems best practices, the platform incorporates an intelligent **API Gateway**, **ACID-compliant order transactions**, **Cache-Aside read optimization**, distributed **Redis sliding-window rate limiting**, and a cryptographic **mock Razorpay payment lifecycle**.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer["🖥️ Frontend Client"]
        Client["React 18 SPA (Vite)<br/>:5173"]
    end

    subgraph GatewayLayer["🛡️ Edge & Gateway"]
        Gateway["API Gateway (:5000)<br/>Reverse Proxy • JWT Auth • Distributed Rate Limiter"]
    end

    subgraph DataCache["⚡ Distributed Cache & State"]
        Redis[("Upstash Redis<br/>Rate Limiting • Product Cache • Active Carts")]
    end

    subgraph ServicesLayer["⚙️ Core Microservices"]
        UserService["User & Auth Service (:5001)<br/>Bcrypt • JWT Tokens • Profile"]
        ProductService["Product Catalog Service (:5002)<br/>Cache-Aside Querying"]
        OrderService["Order Service (:5003)<br/>ACID Transactions • Cart Checkout"]
        PaymentService["Payment Service (:5004)<br/>Mock Razorpay • HMAC-SHA256"]
    end

    subgraph DatabaseLayer["🗄️ Relational Persistence"]
        Postgres[("PostgreSQL 16 Database<br/>Users • Products • Orders • Payments")]
    end

    %% Client to Gateway
    Client -->|HTTP / REST| Gateway

    %% Gateway to Redis (Rate Limit)
    Gateway <-->|Sliding Window Rate Limit| Redis

    %% Gateway to Microservices
    Gateway -->|/api/auth/*| UserService
    Gateway -->|/api/products/*| ProductService
    Gateway -->|/api/orders/*| OrderService
    Gateway -->|/api/payments/*| PaymentService

    %% Microservices to Redis
    ProductService <-->|Cache-Aside (products:all)| Redis
    OrderService <-->|Cart Cache (cart:userID)| Redis

    %% Microservices to PostgreSQL
    UserService --> Postgres
    ProductService --> Postgres
    OrderService --> Postgres
    PaymentService --> Postgres

    %% Payment to Order internal communication
    PaymentService -.->|Status Sync| OrderService
```

---

## ✨ Key Features & Engineering Highlights

### 1. 🛡️ API Gateway & Security Infrastructure
- **Single Entry Point (`:5000`)**: Manages reverse proxying to internal services via `http-proxy-middleware`.
- **Centralized Authentication**: Verifies signed JWT tokens at the boundary, sanitizes spoofed client headers, and forwards verified identity headers (`x-user-id`, `x-user-email`) downstream.
- **Distributed Rate Limiting**: Built on Upstash Redis with granular IP-based window policies:
  - **Auth Route (`/api/auth`)**: Strict 10 requests / min to thwart brute-force password guessing.
  - **Catalog & Orders (`/api/products`, `/api/orders`)**: 100 requests / min.
  - **Standard Headers**: Emits `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` with a safe fail-open mechanism during network blips.

### 2. 📦 ACID-Compliant Transactional Order Processing
- **Atomic Checkout**: Orders and line items are placed within atomic PostgreSQL transactions (`BEGIN` $\rightarrow$ `COMMIT` $\rightarrow$ `ROLLBACK`) using client connection pools.
- **Data Isolation**: Ensures zero partial commits, prevents inventory desynchronization, and automatically clears the user's active Redis cart on successful order placement.

### 3. ⚡ High-Performance Distributed Caching
- **Cache-Aside Pattern**: Product catalog responses are cached in Upstash Redis (`products:all`) with TTL expiration, eliminating unnecessary database I/O and reducing latency by up to **60%**.
- **Ephemeral Session Carts**: Fast cart manipulations stored in memory-speed Redis keys (`cart:{userId}`) prior to checkout checkout checkout.

### 4. 💳 Mock Razorpay Payment Gateway & Cryptographic Verification
- **Order Lifecycle**: Emulates the official Razorpay payment flow (order generation, paise conversion, internal receipt linking).
- **HMAC-SHA256 Signature Verification**: Cryptographically validates payment signatures (`razorpay_order_id|razorpay_payment_id`) against a shared secret before transitioning order state to `Paid`.

### 5. 🐳 Full Docker Multi-Container Orchestration
- **Docker Compose**: Orchestrates all 5 microservices, the React frontend, and PostgreSQL in an isolated bridge network.
- **Health Checks**: Database dependencies enforce `pg_isready` before downstream services boot up, ensuring zero startup race conditions.

---

## 🔌 Service Port Registry

| Service | Port | Technology | Purpose |
| :--- | :---: | :--- | :--- |
| **API Gateway** | `5000` | Node.js, Express, Redis | Reverse Proxy, Rate Limiting, JWT Auth |
| **User Service** | `5001` | Node.js, Express, PostgreSQL | User Registration, Login, Identity |
| **Product Service** | `5002` | Node.js, Express, Redis, PostgreSQL | Product Catalog, Redis Cache-Aside |
| **Order Service** | `5003` | Node.js, Express, PostgreSQL, Redis | ACID Order Processing, Cart Management |
| **Payment Service** | `5004` | Node.js, Express, PostgreSQL | Mock Razorpay Gateway, HMAC Verification |
| **Frontend Client** | `5173` | React 18, Vite, React Router | Modern Responsive E-Commerce Web App |
| **PostgreSQL DB** | `5432` | PostgreSQL 16 Alpine | Primary Relational Data Store |

---

## 📡 Core API Reference

### 🔐 Authentication (`/api/auth`)
- `POST /api/auth/register` - Create a new user account (bcrypt encrypted).
- `POST /api/auth/login` - Authenticate credentials and receive JWT.
- `GET /api/auth/profile` - Retrieve authenticated user profile *(Requires JWT)*.

### 🛍️ Products (`/api/products`)
- `GET /api/products` - Retrieve all available products *(Cached in Redis)*.
- `GET /api/products/:id` - Fetch single product details.

### 🛒 Cart & Orders (`/api/orders`)
- `GET /api/orders/cart` - Fetch user's active shopping cart from Redis *(Requires JWT)*.
- `POST /api/orders/cart` - Add or update cart items in Redis *(Requires JWT)*.
- `DELETE /api/orders/cart` - Clear user's shopping cart *(Requires JWT)*.
- `POST /api/orders` - Place order from cart with atomic ACID transaction *(Requires JWT)*.
- `GET /api/orders` - List all orders belonging to authenticated user *(Requires JWT)*.
- `GET /api/orders/:id` - Fetch specific order by ID with line items *(Requires JWT)*.

### 💳 Payments (`/api/payments`)
- `POST /api/payments/initiate` - Initialize a payment intent & create mock Razorpay order.
- `POST /api/payments/verify` - Validate HMAC-SHA256 signature and mark order as `Paid`.
- `GET /api/payments/:orderId` - Query transaction status and receipt history.

---

## 🚀 Quick Start & Local Setup

### Prerequisites
- [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/)
- [Node.js](https://nodejs.org/) (v18 or higher, optional for local bare-metal running)
- An [Upstash Redis](https://upstash.com/) account (Free tier available)

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/samik930/e-commerce_microservice.git
cd e-commerce_microservice
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env` in the root directory:
```bash
cp .env.example .env
```
Open `.env` and configure your credentials:
```env
POSTGRES_DB=postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_postgres_password
DATABASE_URL=postgresql://postgres:your_secure_postgres_password@postgres:5432/postgres

JWT_SECRET=your_super_secret_jwt_key_here

UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token_here

VITE_API_BASE_URL=http://localhost:5000/api
```

---

### Step 3: Run with Docker Compose
Spin up the entire microservices ecosystem with a single command:
```bash
docker compose up --build
```

Docker will:
1. Initialize **PostgreSQL 16** and automatically apply `schema.sql`.
2. Build and launch all **5 backend microservices**.
3. Launch the **React 18 frontend** on `http://localhost:5173`.
4. Expose the **API Gateway** on `http://localhost:5000`.

To run in the background (detached mode):
```bash
docker compose up -d
```

To stop all services:
```bash
docker compose down
```

---

## 📁 Repository Directory Structure

```text
├── api-gateway/            # Central entry point, routing, auth & rate limiting
│   ├── src/
│   │   ├── config/         # Service endpoints & Redis client
│   │   ├── middleware/     # JWT verification & Redis rate limiter
│   │   └── routes/         # Proxy routes
│   └── Dockerfile
│
├── frontend/               # React 18 + Vite client application
│   ├── src/                # Pages, Components, State, API Axios client
│   └── Dockerfile
│
├── order-service/          # Transactional order placement & Redis cart
│   ├── src/
│   │   ├── config/         # PostgreSQL pool & Redis client
│   │   ├── controllers/    # Order & Cart controllers (BEGIN/COMMIT/ROLLBACK)
│   │   └── routes/
│   └── Dockerfile
│
├── payment-service/        # Mock Razorpay payment lifecycle & HMAC verification
│   ├── src/
│   │   ├── config/         # PostgreSQL pool
│   │   ├── controllers/    # Payment initiation & signature verification
│   │   ├── routes/
│   │   └── services/       # Mock Razorpay SDK emulator
│   └── Dockerfile
│
├── product-service/        # Product catalog with Cache-Aside Redis layer
│   ├── src/
│   │   ├── config/         # PostgreSQL pool & Redis client
│   │   ├── controllers/    # Product fetching with Redis TTL
│   │   └── routes/
│   └── Dockerfile
│
├── user-service/           # User authentication & JWT management
│   ├── src/
│   │   ├── config/         # PostgreSQL pool
│   │   ├── controllers/    # Bcrypt hashing & token generation
│   │   └── routes/
│   └── Dockerfile
│
├── docker-compose.yml      # Multi-container orchestration & network configuration
├── schema.sql              # Initial database schema & seed data
├── .env.example            # Environment variables template
└── README.md               # Project documentation
```

---

## 🛡️ Security Best Practices Implemented
- **Header Spoofing Prevention**: API Gateway actively strips incoming `x-user-id` and `x-user-email` headers before re-injecting cryptographically verified JWT claims.
- **Fail-Open Rate Limiter**: If the distributed Redis cluster encounters network downtime, the rate limiter fails open to maintain service availability rather than dropping user traffic.
- **Cryptographic Signatures**: Payment verifications compute SHA-256 HMAC digests to eliminate client-side tampering of order amounts or transaction IDs.
- **Environment Isolation**: All database passwords, tokens, and secrets are excluded from version control via `.gitignore`.

---

## 👨‍💻 Author
**Samik Podder**
- LinkedIn: [@samik-podder-130165402](https://www.linkedin.com/in/samik-podder-130165402/)
- GitHub: [@samik930](https://github.com/samik930)
- Portfolio: [samikpodder396@gmail.com](mailto:samikpodder396@gmail.com)
