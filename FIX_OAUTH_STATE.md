# Fix OAuth State Error - Complete Solution

## The Problem
You got: `http://localhost:5173/?error=invalid_request&error_code=bad_oauth_state`

This means:
1. OAuth redirect went to wrong port (5173 instead of 8080)
2. OAuth state expired or was lost during redirect

## Immediate Fix - Clear Browser State

1. **Open this file in your browser:**
   ```
   file:///c:/Users/user/OneDrive/Desktop/AceTutor%20Remastered/pixel-perfect-snapshot-863-main/clear-oauth-state.html
   ```

2. **Or manually clear localStorage:**
   - Open http://localhost:8080
   - Press F12 (Developer Tools)
   - Go to Console tab
   - Run this command:
   ```javascript
   localStorage.clear(); sessionStorage.clear(); location.reload();
   ```

3. **Clear browser cache:**
   - Close all localhost:8080 tabs
   - Clear browser cache (Ctrl+Shift+Delete)
   - Restart browser

## Configuration Fixes Applied

✅ Updated Supabase client with proper OAuth settings
✅ Fixed redirect URL to use current origin
✅ Enabled PKCE flow for better security

## Next Steps

1. **Clear your browser state** (steps above)

2. **Configure Supabase Dashboard:**
   - Go to: https://supabase.com/dashboard/project/pwkeqkxipuyxpezzreca
   - Navigate to: **Authentication → URL Configuration**
   - Add Site URL: `http://localhost:8080`
   - Add Redirect URLs:
     ```
     http://localhost:8080/auth/callback
     http://localhost:8080/**
     ```
   - Click Save

3. **Use Demo Accounts (Recommended):**
   - Go to http://localhost:8080/login
   - Click "Continue with Google"
   - Select "Jane Doe" or "Alex Mensah"
   - These bypass real Google OAuth and work immediately

4. **For Real Google OAuth:**
   - Configure Google provider in Supabase
   - Add OAuth credentials (Client ID/Secret)
   - Add callback URL to Google Cloud Console:
     ```
     https://pwkeqkxipuyxpezzreca.supabase.co/auth/v1/callback
     ```

## Why This Happened

The error occurred because:
- Port mismatch: Vite default is 5173, but your app runs on 8080
- OAuth state was stored for one port but callback came to another
- Browser had stale OAuth state from previous attempts

## Test After Fixing

1. Clear browser completely (steps above)
2. Go to http://localhost:8080/login
3. Try demo accounts first
4. Then test real Google OAuth (after Supabase config)

