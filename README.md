# RupeeFast Backend

Loan application management system backend API.

## Quick Deploy to Render.com (Free)

### Step 1: Create Free PostgreSQL Database
1. Go to https://neon.tech and sign up (free)
2. Create a new project called "rupeefast"
3. Copy the connection string (looks like: `postgresql://user:password@host/dbname?sslmode=require`)

### Step 2: Deploy to Render
1. Go to https://render.com and sign up with GitHub
2. Click "New +" > "Web Service"
3. Connect this GitHub repository
4. Settings:
   - Name: `rupeefast-backend`
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: Free
5. Add Environment Variable:
   - Key: `DATABASE_URL`
   - Value: (paste your Neon connection string)
6. Click "Create Web Service"

## API Endpoints

### Auth
- `POST /api/auth/send-otp` - Send OTP to mobile
- `POST /api/auth/verify-otp` - Verify OTP (use 123456)

### User
- `GET /api/user/:id` - Get user profile
- `PUT /api/user/:id/personal` - Update personal details
- `POST /api/user/:id/kyc` - Upload KYC documents
- `PUT /api/user/:id/banking` - Update bank details

### Applications
- `POST /api/applications` - Create loan application
- `GET /api/applications/user/:userId` - Get user's applications

### Admin
- `POST /api/admin/login` - Admin login (admin@rupeefast.com / Admin@123)
- `GET /api/admin/stats` - Dashboard statistics
- `GET /api/admin/applications` - All applications
- `GET /api/admin/applications/:id` - Single application detail
- `PUT /api/admin/applications/:id/status` - Update status

### Health
- `GET /api/health` - Health check

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Server port (default: 3000)
