const errorResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
});

export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Universal Ecommerce Analytics API',
    version: '1.0.0',
    description:
      'Phase 1 (foundation/health), Phase 2 (authentication & user management), Phase 3 (multi-tenant website management), Phase 4 (universal event collection), Phase 5 (visitor & session resolution), Phase 6 (normalized ecommerce data: Product/Cart/Checkout/Order, resolved from events), Phase 7 (durable queue + background worker for asynchronous, retryable event processing), Phase 8 (internal analytics aggregation into pre-aggregated hourly/daily statistics), and Phase 9 (the authenticated Analytics Reporting API — overview, time-series, product, conversion, cart/checkout, and revenue reports, reading Phase 8\'s aggregates only) of the Universal Ecommerce Analytics backend.',
  },
  servers: [{ url: '/', description: 'Current server' }],
  tags: [
    { name: 'Health', description: 'Service health' },
    { name: 'Auth', description: 'Registration, login, session, and user identity' },
    { name: 'Websites', description: "Manage the authenticated user's websites (multi-tenant root resource)" },
    { name: 'Collector', description: 'Public, framework-agnostic event ingestion for the tracking script' },
    { name: 'Reports', description: "Read-only analytics reporting over the authenticated user's own websites (Phase 9) — reads Phase 8's pre-aggregated collections only, never raw Events." },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Send the access token returned from /api/auth/login or /api/auth/register as `Authorization: Bearer <token>`.',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Invalid email or password.' },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'INVALID_CREDENTIALS' },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '66b1f0c9e1a2b3c4d5e6f7a8' },
          name: { type: 'string', example: 'John Doe' },
          email: { type: 'string', example: 'john@example.com' },
          role: { type: 'string', enum: ['user', 'admin'], example: 'user' },
          status: { type: 'string', enum: ['active', 'suspended'], example: 'active' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      AuthResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            },
          },
        },
      },
      RegisterRequest: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', example: 'John Doe' },
          email: { type: 'string', example: 'john@example.com' },
          password: { type: 'string', format: 'password', minLength: 8, example: 'secure-password' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', example: 'john@example.com' },
          password: { type: 'string', format: 'password', example: 'secure-password' },
        },
      },
      Website: {
        type: 'object',
        description:
          'ownerId is intentionally never included — every website in a response always belongs to the caller.',
        properties: {
          id: { type: 'string', description: 'Internal MongoDB id — used by the dashboard API.', example: '66b1f0c9e1a2b3c4d5e6f7a8' },
          websiteId: {
            type: 'string',
            description: 'Public tracking identifier, unrelated to `id`. This is what gets embedded in the tracking script.',
            example: 'a1b2c3d4e5f60718',
          },
          name: { type: 'string', example: 'My Ecommerce Store' },
          domain: {
            type: 'string',
            description: 'Normalized hostname only (no scheme/path/port). "www.example.com" and "example.com" are distinct.',
            example: 'example.com',
          },
          status: { type: 'string', enum: ['active', 'paused', 'archived'], example: 'active' },
          timezone: { type: 'string', example: 'Asia/Dhaka' },
          currency: { type: 'string', example: 'BDT' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      WebsiteResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: { website: { $ref: '#/components/schemas/Website' } },
          },
        },
      },
      CreateWebsiteRequest: {
        type: 'object',
        required: ['name', 'domain', 'timezone', 'currency'],
        description: 'ownerId, websiteId, _id, createdAt, and updatedAt are server-generated and ignored if sent.',
        properties: {
          name: { type: 'string', maxLength: 120, example: 'My Ecommerce Store' },
          domain: { type: 'string', example: 'https://example.com' },
          timezone: { type: 'string', example: 'Asia/Dhaka' },
          currency: { type: 'string', example: 'BDT' },
        },
      },
      UpdateWebsiteRequest: {
        type: 'object',
        description:
          'All fields optional, but at least one is required. status accepts only "active" or "paused" — use DELETE to archive.',
        properties: {
          name: { type: 'string', maxLength: 120 },
          domain: { type: 'string' },
          timezone: { type: 'string' },
          currency: { type: 'string' },
          status: { type: 'string', enum: ['active', 'paused'] },
        },
      },
      EventItem: {
        type: 'object',
        required: ['productId', 'price', 'quantity'],
        properties: {
          productId: { type: 'string', maxLength: 200, example: 'p123' },
          name: { type: 'string', maxLength: 500, example: 'Laptop' },
          price: { type: 'number', minimum: 0, example: 85000 },
          quantity: { type: 'integer', minimum: 1, example: 2 },
        },
      },
      CollectEventRequest: {
        type: 'object',
        required: ['websiteId', 'event'],
        description:
          'The `data` shape depends on `event`. See the per-event examples. Unknown/unlisted fields inside `data` are silently dropped, never stored — this is the primary defense against a client accidentally sending sensitive fields.',
        properties: {
          websiteId: {
            type: 'string',
            description: 'Public identifier from the tracking snippet (data-website-id). Not a secret.',
            example: 'a1b2c3d4e5f60718',
          },
          event: {
            type: 'string',
            enum: ['page_view', 'product_view', 'add_to_cart', 'remove_from_cart', 'checkout', 'purchase'],
          },
          eventId: {
            type: 'string',
            description: 'Optional client-generated id for idempotency (1-128 chars, letters/digits/-/_). Server-generated (UUID) if omitted.',
          },
          eventVersion: { type: 'string', default: '1', example: '1' },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'When the event occurred. Defaults to server receive time if omitted. Rejected if more than ~5 minutes in the future.',
          },
          url: { type: 'string', example: 'https://store.com/product/123' },
          path: { type: 'string', example: '/product/123' },
          title: { type: 'string', example: 'Product Page' },
          referrer: { type: 'string' },
          anonymousId: {
            type: 'string',
            maxLength: 128,
            description: 'Stable per-device/browser id the SDK generates and persists client-side. Identifies a Visitor (websiteId + anonymousId). Optional — omitting it still accepts the event, just without visitor attribution. Never derived from IP, user-agent, or fingerprinting.',
          },
          sessionId: {
            type: 'string',
            maxLength: 128,
            description: 'SDK-persisted session id. Identifies a Session (websiteId + sessionId); a new one is started once the session inactivity timeout has elapsed. Optional — if omitted (but anonymousId is present), the server generates one per event, so send it for meaningful session grouping.',
          },
          language: { type: 'string', example: 'en-US' },
          screenWidth: { type: 'integer', example: 1920 },
          screenHeight: { type: 'integer', example: 1080 },
          timezone: { type: 'string', example: 'Asia/Dhaka' },
          data: {
            oneOf: [
              {
                title: 'product_view',
                type: 'object',
                required: ['productId'],
                properties: {
                  productId: { type: 'string' },
                  name: { type: 'string' },
                  price: { type: 'number', minimum: 0 },
                  currency: { type: 'string', example: 'BDT' },
                },
              },
              {
                title: 'add_to_cart',
                type: 'object',
                required: ['productId', 'price', 'quantity'],
                description:
                  'quantity is INCREMENTAL ("this many were just added") — repeated add_to_cart events for the same product accumulate rather than replacing the quantity. See docs/DATABASE_ARCHITECTURE.md.',
                properties: {
                  productId: { type: 'string' },
                  name: { type: 'string' },
                  price: { type: 'number', minimum: 0 },
                  quantity: { type: 'integer', minimum: 1 },
                  currency: { type: 'string', example: 'BDT' },
                  cartId: {
                    type: 'string',
                    description: 'Optional (Phase 6). Links this action to a Cart/CartItem. Omitting it still accepts the event, just without cart attribution.',
                  },
                },
              },
              {
                title: 'remove_from_cart',
                type: 'object',
                required: ['productId', 'quantity'],
                description:
                  'quantity is INCREMENTAL ("remove this many"), clamped so it can never go negative — removing more than present deletes the line item. price is not required here (Phase 6).',
                properties: {
                  productId: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1 },
                  price: { type: 'number', minimum: 0, description: 'Optional — not needed to identify or remove a cart line.' },
                  cartId: { type: 'string', description: 'Optional (Phase 6), same as add_to_cart.' },
                },
              },
              {
                title: 'checkout',
                type: 'object',
                required: ['items', 'cartValue', 'currency'],
                description:
                  'cartValue is the original (Phase 4) required field, kept for backward compatibility. checkoutId, cartId, and a full subtotal/discount/shipping/tax/total breakdown are optional (Phase 6) — total defaults to cartValue when not sent. If ALL five of subtotal/discount/shipping/tax/total are supplied, they must reconcile (subtotal - discount + shipping + tax = total, ±0.01) or the event is rejected (INVALID_EVENT_DATA).',
                properties: {
                  items: { type: 'array', maxItems: 100, items: { $ref: '#/components/schemas/EventItem' } },
                  cartValue: { type: 'number', minimum: 0, example: 170000 },
                  currency: { type: 'string', example: 'BDT' },
                  checkoutId: { type: 'string', description: 'Links this event to a Checkout entity; also used by a later purchase to mark it completed.' },
                  cartId: { type: 'string', description: 'Links this checkout to the Cart it originated from.' },
                  subtotal: { type: 'number', minimum: 0 },
                  discount: { type: 'number', minimum: 0 },
                  shipping: { type: 'number', minimum: 0 },
                  tax: { type: 'number', minimum: 0 },
                  total: { type: 'number', minimum: 0 },
                },
              },
              {
                title: 'purchase',
                type: 'object',
                required: ['orderId', 'revenue', 'currency', 'items'],
                description:
                  'revenue is the original (Phase 4) required field, kept for backward compatibility. checkoutId, a full financial breakdown, and paymentStatus are optional (Phase 6) — total defaults to revenue when not sent, and the same reconciliation rule as checkout applies when all five breakdown fields are present. orderId is the idempotency key (websiteId + orderId): resubmitting the same order updates it rather than creating a duplicate, and OrderItems are only ever created once, the first time.',
                properties: {
                  orderId: { type: 'string', example: 'ORDER-123' },
                  revenue: { type: 'number', minimum: 0, example: 170000 },
                  currency: { type: 'string', example: 'BDT' },
                  items: { type: 'array', maxItems: 100, items: { $ref: '#/components/schemas/EventItem' } },
                  checkoutId: { type: 'string', description: 'If this matches a known Checkout, it is marked completed. No effect if it doesn\'t match anything.' },
                  subtotal: { type: 'number', minimum: 0 },
                  discount: { type: 'number', minimum: 0 },
                  shipping: { type: 'number', minimum: 0 },
                  tax: { type: 'number', minimum: 0 },
                  total: { type: 'number', minimum: 0 },
                  paymentStatus: { type: 'string', enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'] },
                },
              },
            ],
          },
        },
      },
      CollectAcceptedResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              accepted: { type: 'boolean', example: true },
              eventId: { type: 'string', example: 'a3f1c2e4-9b7d-4e2a-8c1f-6d5e4b3a2c1d' },
            },
          },
        },
      },
      CollectDuplicateResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              accepted: { type: 'boolean', example: true },
              duplicate: { type: 'boolean', example: true },
              eventId: { type: 'string', example: 'a3f1c2e4-9b7d-4e2a-8c1f-6d5e4b3a2c1d' },
            },
          },
        },
      },
      ReportRange: {
        type: 'object',
        properties: {
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          granularity: { type: 'string', enum: ['hour', 'day'] },
        },
      },
      OverviewReport: {
        type: 'object',
        description: 'Phase 9 §1. All monetary fields are major-unit numbers converted once from integer minor units — never accumulated as floats.',
        properties: {
          range: { $ref: '#/components/schemas/ReportRange' },
          currency: { type: 'string', example: 'USD' },
          pageViews: { type: 'integer', example: 1200 },
          productViews: { type: 'integer', example: 480 },
          addToCart: { type: 'integer', example: 90 },
          removeFromCart: { type: 'integer', example: 12 },
          checkoutStarted: { type: 'integer', example: 40 },
          checkoutCompleted: { type: 'integer', example: 25 },
          orders: { type: 'integer', example: 25 },
          grossRevenue: { type: 'number', example: 1250.5 },
          refundedAmount: { type: 'number', example: 30 },
          netRevenue: { type: 'number', example: 1220.5 },
          uniqueVisitors: { type: 'integer', description: 'TRUE distinct count across the range, not a sum of per-bucket uniques.', example: 320 },
          uniqueSessions: { type: 'integer', example: 410 },
          conversionRate: { type: 'number', description: 'orders / uniqueVisitors * 100. 0 when uniqueVisitors is 0 — never NaN/Infinity.', example: 7.81 },
        },
      },
      OverviewResult: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, data: { $ref: '#/components/schemas/OverviewReport' } },
      },
      TimeSeriesPoint: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date-time', description: 'The bucket start, UTC.' },
          pageViews: { type: 'integer' },
          uniqueVisitors: { type: 'integer', description: 'This single bucket\'s own true unique count.' },
          uniqueSessions: { type: 'integer' },
          productViews: { type: 'integer' },
          addToCart: { type: 'integer' },
          removeFromCart: { type: 'integer' },
          checkoutStarted: { type: 'integer' },
          checkoutCompleted: { type: 'integer' },
          orders: { type: 'integer' },
          unitsSold: { type: 'integer' },
          grossRevenue: { type: 'number' },
          refundedAmount: { type: 'number' },
          netRevenue: { type: 'number' },
        },
      },
      TimeSeriesResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              granularity: { type: 'string', enum: ['hour', 'day'] },
              range: { type: 'object', properties: { from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } } },
              currency: { type: 'string' },
              points: { type: 'array', items: { $ref: '#/components/schemas/TimeSeriesPoint' } },
            },
          },
        },
      },
      ProductListItem: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'The EXTERNAL product id — never a MongoDB _id.', example: 'sku-123' },
          productName: { type: 'string', nullable: true, example: 'Wireless Mouse' },
          views: { type: 'integer' },
          addToCart: { type: 'integer' },
          removeFromCart: { type: 'integer' },
          purchaseQuantity: { type: 'integer' },
          orders: { type: 'integer' },
          revenue: { type: 'number' },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 137 },
          totalPages: { type: 'integer', example: 7 },
        },
      },
      ProductListResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              range: { $ref: '#/components/schemas/ReportRange' },
              currency: { type: 'string' },
              items: { type: 'array', items: { $ref: '#/components/schemas/ProductListItem' } },
              pagination: { $ref: '#/components/schemas/Pagination' },
            },
          },
        },
      },
      ProductDetailResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              range: { $ref: '#/components/schemas/ReportRange' },
              currency: { type: 'string' },
              productId: { type: 'string' },
              productName: { type: 'string', nullable: true },
              views: { type: 'integer' },
              addToCart: { type: 'integer' },
              removeFromCart: { type: 'integer' },
              checkoutQuantity: {
                type: 'integer',
                nullable: true,
                description: 'Always null: Phase 8 does not track a per-product checkout-line quantity (only website-level checkoutStarted/checkoutCompleted exist). Not fabricated from raw Events.',
              },
              purchaseQuantity: { type: 'integer' },
              orders: { type: 'integer' },
              revenue: { type: 'number' },
              conversionRates: {
                type: 'object',
                properties: {
                  viewToCartRate: { type: 'number' },
                  cartToOrderRate: { type: 'number' },
                },
              },
            },
          },
        },
      },
      ConversionResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              range: { $ref: '#/components/schemas/ReportRange' },
              productViews: { type: 'integer' },
              addToCart: { type: 'integer' },
              checkoutStarted: { type: 'integer' },
              checkoutCompleted: { type: 'integer' },
              orders: { type: 'integer' },
              uniqueVisitors: { type: 'integer' },
              uniqueSessions: { type: 'integer' },
              conversionRates: {
                type: 'object',
                properties: {
                  addToCartRate: { type: 'number' },
                  visitorConversionRate: { type: 'number', description: 'orders / uniqueVisitors * 100' },
                  sessionConversionRate: { type: 'number', description: 'orders / uniqueSessions * 100' },
                  purchaseConversionRate: { type: 'number', description: 'checkoutCompleted / checkoutStarted * 100' },
                },
              },
            },
          },
        },
      },
      CartCheckoutResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              range: { $ref: '#/components/schemas/ReportRange' },
              currency: { type: 'string' },
              addToCart: { type: 'integer' },
              removeFromCart: { type: 'integer' },
              cartsCreated: { type: 'integer' },
              cartItems: { type: 'integer' },
              cartQuantity: { type: 'integer' },
              cartValue: { type: 'number', description: 'Cumulative add-to-cart activity value — explicitly NOT revenue.' },
              checkoutStarted: { type: 'integer' },
              checkoutCompleted: { type: 'integer' },
              conversionRates: {
                type: 'object',
                properties: {
                  cartToCheckoutRate: { type: 'number' },
                  checkoutCompletionRate: { type: 'number' },
                },
              },
            },
          },
        },
      },
      RevenueResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              range: { $ref: '#/components/schemas/ReportRange' },
              currency: { type: 'string' },
              grossRevenue: { type: 'number' },
              refundedAmount: { type: 'number' },
              netRevenue: { type: 'number' },
              orderCount: { type: 'integer' },
              averageOrderValue: { type: 'number', description: '0 when orderCount is 0 — never NaN/Infinity.' },
            },
          },
        },
      },
    },
    parameters: {
      WebsiteIdParam: {
        name: 'websiteId',
        in: 'path',
        required: true,
        description: 'The PUBLIC tracking websiteId (not the internal MongoDB id).',
        schema: { type: 'string', example: 'a1b2c3d4e5f60718' },
      },
      FromParam: {
        name: 'from',
        in: 'query',
        required: true,
        description: 'Range start, inclusive, ISO 8601 date-time.',
        schema: { type: 'string', format: 'date-time', example: '2026-08-01T00:00:00.000Z' },
      },
      ToParam: {
        name: 'to',
        in: 'query',
        required: true,
        description: 'Range end, exclusive, ISO 8601 date-time. Must be >= from.',
        schema: { type: 'string', format: 'date-time', example: '2026-08-20T00:00:00.000Z' },
      },
      GranularityParam: {
        name: 'granularity',
        in: 'query',
        required: false,
        description: 'Which AnalyticsBucket granularity to read from. Default "day". Bounds the maximum allowed range span (92 days for "hour", 731 days for "day").',
        schema: { type: 'string', enum: ['hour', 'day'], default: 'day' },
      },
      PageParam: {
        name: 'page',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, default: 1 },
      },
      LimitParam: {
        name: 'limit',
        in: 'query',
        required: false,
        description: 'Maximum 100.',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      SortParam: {
        name: 'sort',
        in: 'query',
        required: false,
        description: 'Allow-listed field to sort by. Default "revenue".',
        schema: { type: 'string', enum: ['revenue', 'orders', 'views', 'addToCart', 'purchaseQuantity'], default: 'revenue' },
      },
      OrderParam: {
        name: 'order',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Service health check',
        description:
          'Reports MongoDB, Redis, and queue readiness separately (Phase 7). Overall status is "healthy" only when every dependency POST /api/collect actually needs is available — a Redis outage makes this endpoint report "degraded" too, since the collector would then reject new events (§21).',
        responses: {
          200: {
            description: 'Service is healthy — database, redis, and queue are all available',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    status: { type: 'string', enum: ['healthy', 'degraded'], example: 'healthy' },
                    database: { type: 'string', enum: ['connected', 'connecting', 'disconnected', 'disconnecting'] },
                    redis: { type: 'string', enum: ['connected', 'disconnected'] },
                    queue: { type: 'string', enum: ['ready', 'unavailable'] },
                    uptime: { type: 'number', example: 123.45 },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          503: { description: 'Service is degraded — database and/or redis/queue is not available' },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } },
        },
        responses: {
          201: {
            description: 'User registered successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResult' } } },
          },
          400: errorResponse('Validation error (missing/invalid name, email, or password)'),
          409: errorResponse('An account with this email already exists (EMAIL_ALREADY_EXISTS)'),
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with email and password',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResult' } } },
          },
          400: errorResponse('Validation error (missing/malformed email or password)'),
          401: errorResponse('Invalid email or password (INVALID_CREDENTIALS) — generic on purpose'),
          403: errorResponse('Account suspended (ACCOUNT_SUSPENDED)'),
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get the currently authenticated user',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: { user: { $ref: '#/components/schemas/User' } },
                    },
                  },
                },
              },
            },
          },
          401: errorResponse('Missing, malformed, invalid, or expired token (AUTH_REQUIRED / INVALID_TOKEN / TOKEN_EXPIRED)'),
          403: errorResponse('Account suspended (ACCOUNT_SUSPENDED)'),
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Log out the current session',
        description:
          'JWT access tokens are stateless; this endpoint acknowledges logout. The client must discard the token — the token remains cryptographically valid until it expires.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Logout acknowledged' },
          401: errorResponse('Missing, malformed, invalid, or expired token'),
        },
      },
    },
    '/api/websites': {
      post: {
        tags: ['Websites'],
        summary: 'Create a website',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateWebsiteRequest' } } },
        },
        responses: {
          201: {
            description: 'Website created, with a server-generated public websiteId',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WebsiteResult' } } },
          },
          400: errorResponse('Validation error — invalid name/domain/timezone/currency (VALIDATION_ERROR / INVALID_DOMAIN)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          409: errorResponse('Extremely rare websiteId collision that survived retries (DUPLICATE_WEBSITE_ID)'),
        },
      },
      get: {
        tags: ['Websites'],
        summary: "List the authenticated user's websites",
        description: 'Returns only websites owned by the caller — never another user\'s websites.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'List of websites',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        websites: { type: 'array', items: { $ref: '#/components/schemas/Website' } },
                      },
                    },
                  },
                },
              },
            },
          },
          401: errorResponse('Missing, malformed, invalid, or expired token'),
        },
      },
    },
    '/api/websites/{id}': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Internal MongoDB id (not the public websiteId).',
          schema: { type: 'string', example: '66b1f0c9e1a2b3c4d5e6f7a8' },
        },
      ],
      get: {
        tags: ['Websites'],
        summary: 'Get a single website by internal id',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Website',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WebsiteResult' } } },
          },
          400: errorResponse('Malformed id (INVALID_WEBSITE_ID)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse(
            'Website does not exist, OR belongs to another user (WEBSITE_NOT_FOUND). The same 404 is returned in both cases so a caller cannot use this endpoint to probe which website ids exist.'
          ),
        },
      },
      patch: {
        tags: ['Websites'],
        summary: 'Update a website',
        description:
          'Only the owner can update. websiteId, ownerId, _id, createdAt, and updatedAt cannot be changed. status cannot be set to "archived" here — use DELETE.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateWebsiteRequest' } } },
        },
        responses: {
          200: {
            description: 'Updated website',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WebsiteResult' } } },
          },
          400: errorResponse('Validation error, or no updatable fields provided (VALIDATION_ERROR / INVALID_DOMAIN / INVALID_WEBSITE_STATUS / INVALID_WEBSITE_ID)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse('Website does not exist, or belongs to another user (WEBSITE_NOT_FOUND)'),
          409: errorResponse('The website has been archived and is now immutable (WEBSITE_ARCHIVED)'),
        },
      },
      delete: {
        tags: ['Websites'],
        summary: 'Archive (soft-delete) a website',
        description:
          'Sets status to "archived" rather than physically deleting the record, since future analytics data will reference this website by its internal id. Idempotent: archiving an already-archived website simply returns its current state. Once archived, POST /api/collect (Phase 4) must refuse new events for it, and PATCH is blocked (WEBSITE_ARCHIVED).',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Website archived (status: "archived")',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WebsiteResult' } } },
          },
          400: errorResponse('Malformed id (INVALID_WEBSITE_ID)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse('Website does not exist, or belongs to another user (WEBSITE_NOT_FOUND)'),
        },
      },
    },
    '/api/collect': {
      post: {
        tags: ['Collector'],
        summary: 'Submit an analytics event (public, framework-agnostic ingestion)',
        description:
          'No Authorization header / JWT — this endpoint is called directly by the tracking script embedded in a customer\'s website, so it authenticates the WEBSITE via the public `websiteId` in the body, not the caller via a bearer token. CORS reflects any Origin (no credentials involved). Body size is capped at 32KB. A best-effort, single-process, in-memory rate limit applies per IP (not production-grade distributed protection — see src/middleware/rateLimiter.js).\n\n**Visitor & session resolution (internal, not a separate API):** if `anonymousId` is present, the event is attached to a Visitor identified by `websiteId + anonymousId` (created on first sight, reused after); if `sessionId` is also present, it\'s attached to a Session identified by `websiteId + sessionId`, reusing an active one or starting a new one once the configured inactivity window has elapsed. Neither `anonymousId` nor `sessionId` is required — omitting `anonymousId` still accepts the event, just without visitor/session attribution.\n\n**Commerce normalization (Phase 6, also internal):** product_view/add_to_cart/checkout/purchase events additionally upsert normalized Product/Cart/CartItem/Checkout/Order/OrderItem documents. All monetary fields on those normalized documents are stored as integer minor units (e.g. 850.50 → 85050); the raw major-unit numbers sent in this request are preserved unchanged on the Event document itself. There is no public API to read or write any of these entities directly — they exist only as a side effect of event collection, for later phases (starting with an authenticated dashboard) to build on.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CollectEventRequest' } } },
        },
        responses: {
          202: {
            description: 'New event accepted and stored.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CollectAcceptedResult' } } },
          },
          200: {
            description:
              'Idempotent replay: an event with this websiteId + eventId was already accepted. No new document was created.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CollectDuplicateResult' } } },
          },
          400: errorResponse(
            'Malformed request, missing/invalid websiteId or event, invalid ecommerce data, or invalid timestamp (VALIDATION_ERROR / INVALID_WEBSITE_ID / UNSUPPORTED_EVENT / INVALID_EVENT_DATA / INVALID_TIMESTAMP / INVALID_EVENT_ID)'
          ),
          403: errorResponse(
            'The website exists but is not accepting events right now — archived (WEBSITE_ARCHIVED) or paused (WEBSITE_PAUSED). Both are rejected outright, not silently accepted, for clean semantics.'
          ),
          404: errorResponse('No website matches this websiteId (WEBSITE_NOT_FOUND)'),
          413: errorResponse('Request body exceeds the 32KB collector limit (PAYLOAD_TOO_LARGE)'),
          429: errorResponse('Too many events from this source too quickly (RATE_LIMITED) — development-only in-memory limiter'),
        },
      },
    },
    '/api/reports/{websiteId}/overview': {
      parameters: [{ $ref: '#/components/parameters/WebsiteIdParam' }],
      get: {
        tags: ['Reports'],
        summary: 'Ecommerce analytics summary for a website and date range',
        description:
          'Reads AnalyticsBucket (summed via MongoDB $sum, never in JavaScript) plus true distinct-visitor/session counts from AnalyticsVisitorBucket/AnalyticsSessionBucket. Never scans Event. conversionRate = orders / uniqueVisitors * 100 (0 when uniqueVisitors is 0).',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/FromParam' },
          { $ref: '#/components/parameters/ToParam' },
          { $ref: '#/components/parameters/GranularityParam' },
        ],
        responses: {
          200: { description: 'Overview report', content: { 'application/json': { schema: { $ref: '#/components/schemas/OverviewResult' } } } },
          400: errorResponse('Invalid/missing date range or granularity (INVALID_DATE_RANGE / INVALID_GRANULARITY)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse('Website does not exist, or belongs to another user (WEBSITE_NOT_FOUND) — same response for both, see /api/websites/{id}'),
        },
      },
    },
    '/api/reports/{websiteId}/timeseries': {
      parameters: [{ $ref: '#/components/parameters/WebsiteIdParam' }],
      get: {
        tags: ['Reports'],
        summary: 'Analytics over time (hourly or daily points)',
        description: 'Each point is one AnalyticsBucket document, formatted only — never summed or recomputed across points. Points are ordered ascending by bucket start.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/FromParam' },
          { $ref: '#/components/parameters/ToParam' },
          { $ref: '#/components/parameters/GranularityParam' },
        ],
        responses: {
          200: { description: 'Time-series report', content: { 'application/json': { schema: { $ref: '#/components/schemas/TimeSeriesResult' } } } },
          400: errorResponse('Invalid/missing date range or granularity (INVALID_DATE_RANGE / INVALID_GRANULARITY)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse('Website does not exist, or belongs to another user (WEBSITE_NOT_FOUND)'),
        },
      },
    },
    '/api/reports/{websiteId}/products': {
      parameters: [{ $ref: '#/components/parameters/WebsiteIdParam' }],
      get: {
        tags: ['Reports'],
        summary: 'Top / paginated product performance list',
        description:
          'One MongoDB aggregation pipeline ($match -> $group -> $sort -> $facet) does grouping, summing, sorting, AND pagination together — never a separate count query, never paginated in JavaScript. `sort` is validated against an explicit allow-list (src/constants/reportingSort.js); an unrecognized value is rejected, never passed through to MongoDB. productId is always the EXTERNAL product id.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/FromParam' },
          { $ref: '#/components/parameters/ToParam' },
          { $ref: '#/components/parameters/GranularityParam' },
          { $ref: '#/components/parameters/SortParam' },
          { $ref: '#/components/parameters/OrderParam' },
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
        ],
        responses: {
          200: { description: 'Product list report', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductListResult' } } } },
          400: errorResponse('Invalid date range/granularity/sort/order/page/limit (INVALID_DATE_RANGE / INVALID_GRANULARITY / INVALID_SORT / INVALID_PAGINATION)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse('Website does not exist, or belongs to another user (WEBSITE_NOT_FOUND)'),
        },
      },
    },
    '/api/reports/{websiteId}/products/{productId}': {
      parameters: [
        { $ref: '#/components/parameters/WebsiteIdParam' },
        { name: 'productId', in: 'path', required: true, description: 'The EXTERNAL product id, never a MongoDB _id.', schema: { type: 'string', example: 'sku-123' } },
      ],
      get: {
        tags: ['Reports'],
        summary: 'Detailed report for a single product',
        description:
          'Always scoped by websiteId. If the product has analytics activity in range OR is a known Product (Phase 6), returns a report (zeroed if no activity in range but the product is real). If the product is entirely unknown to this website, returns 404 PRODUCT_NOT_FOUND. checkoutQuantity is always null — Phase 8 does not track a per-product checkout-line quantity, and this endpoint never fabricates one from raw Events.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/FromParam' },
          { $ref: '#/components/parameters/ToParam' },
          { $ref: '#/components/parameters/GranularityParam' },
        ],
        responses: {
          200: { description: 'Product detail report', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductDetailResult' } } } },
          400: errorResponse('Invalid product id, date range, or granularity (INVALID_PRODUCT_ID / INVALID_DATE_RANGE / INVALID_GRANULARITY)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse('Website not found (WEBSITE_NOT_FOUND), or product entirely unknown to this website (PRODUCT_NOT_FOUND)'),
        },
      },
    },
    '/api/reports/{websiteId}/conversion': {
      parameters: [{ $ref: '#/components/parameters/WebsiteIdParam' }],
      get: {
        tags: ['Reports'],
        summary: 'Funnel counts and conversion rates',
        description:
          'Raw counters plus dynamically computed rates — nothing here is stored. visitorConversionRate/sessionConversionRate/purchaseConversionRate reuse the exact formulas documented in docs/ANALYTICS_ARCHITECTURE.md §12; addToCartRate is a Phase 9 addition. Every rate safely returns 0 for a zero denominator.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/FromParam' },
          { $ref: '#/components/parameters/ToParam' },
          { $ref: '#/components/parameters/GranularityParam' },
        ],
        responses: {
          200: { description: 'Conversion report', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversionResult' } } } },
          400: errorResponse('Invalid/missing date range or granularity (INVALID_DATE_RANGE / INVALID_GRANULARITY)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse('Website does not exist, or belongs to another user (WEBSITE_NOT_FOUND)'),
        },
      },
    },
    '/api/reports/{websiteId}/cart-checkout': {
      parameters: [{ $ref: '#/components/parameters/WebsiteIdParam' }],
      get: {
        tags: ['Reports'],
        summary: 'Cart and checkout activity report',
        description:
          'cartValue is cumulative add-to-cart ACTIVITY value, explicitly NOT revenue — never combined with grossRevenue/netRevenue in any calculation, and this report never returns a revenue field at all.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/FromParam' },
          { $ref: '#/components/parameters/ToParam' },
          { $ref: '#/components/parameters/GranularityParam' },
        ],
        responses: {
          200: { description: 'Cart/checkout report', content: { 'application/json': { schema: { $ref: '#/components/schemas/CartCheckoutResult' } } } },
          400: errorResponse('Invalid/missing date range or granularity (INVALID_DATE_RANGE / INVALID_GRANULARITY)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse('Website does not exist, or belongs to another user (WEBSITE_NOT_FOUND)'),
        },
      },
    },
    '/api/reports/{websiteId}/revenue': {
      parameters: [{ $ref: '#/components/parameters/WebsiteIdParam' }],
      get: {
        tags: ['Reports'],
        summary: 'Revenue report (gross/net/refunds/AOV)',
        description:
          'grossRevenue/refundedAmount/netRevenue/averageOrderValue are all derived from Order.total via AnalyticsBucket — never recomputed from raw client event data. averageOrderValue is computed on the integer minor-unit total (single division, no accumulation), converted to major units once at the end; it safely returns 0 for zero orders.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/FromParam' },
          { $ref: '#/components/parameters/ToParam' },
          { $ref: '#/components/parameters/GranularityParam' },
        ],
        responses: {
          200: { description: 'Revenue report', content: { 'application/json': { schema: { $ref: '#/components/schemas/RevenueResult' } } } },
          400: errorResponse('Invalid/missing date range or granularity (INVALID_DATE_RANGE / INVALID_GRANULARITY)'),
          401: errorResponse('Missing, malformed, invalid, or expired token'),
          404: errorResponse('Website does not exist, or belongs to another user (WEBSITE_NOT_FOUND)'),
        },
      },
    },
  },
};
