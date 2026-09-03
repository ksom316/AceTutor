# Google OAuth Redirect URI Fix

## The Error
"Error 400: redirect_uri_mismatch" happens when the redirect URI doesn't match what's registered in Google Cloud Console.

## Solution: Add Redirect URIs to Supabase

1. **Go to your Supabase Dashboard:**
   - Visit: https://supabase.com/dashboard/project/pwkeqkxipuyxpezzreca
   - Navigate to: **Authentication** → **URL Configuration**

2. **Add these Redirect URLs:**
   ```
   http://localhost:8080/auth/callback
   http://localhost:8080/**
   https://*.supabase.co/auth/v1/callback
   ```

3. **Add these Site URLs (if different):**
   ```
   http://localhost:8080
   ```

4. **Save the configuration**

## Alternative: Update Google Cloud Console

If the Supabase configuration doesn't work, you need to add the redirect URI directly in Google Cloud Console:

1. Go to: https://console.cloud.google.com/apis/credentials
2. Select your OAuth 2.0 Client ID
3. Under "Authorized redirect URIs", add:
   ```
   https://pwkeqkxipuyxpezzreca.supabase.co/auth/v1/callback
   http://localhost:8080/auth/callback
   ```
4. Click "Save"

## How the Flow Works

1. User clicks "Continue with Google" → Goes to `/auth/google`
2. Clicks "Use another account" → Supabase creates OAuth URL
3. Redirects to Google with: `redirect_uri=https://pwkeqkxipuyxpezzreca.supabase.co/auth/v1/callback`
4. Google redirects back to Supabase's callback URL
5. Supabase exchanges the code and redirects to: `http://localhost:8080/auth/callback`

The error occurs at step 3-4 because Google doesn't recognize the redirect URI.

## Test After Fixing

1. Clear browser cache/cookies for localhost:8080
2. Go to http://localhost:8080/login
3. Click "Continue with Google"
4. Click "Use another account"
5. Should now redirect to Google's account chooser successfully
