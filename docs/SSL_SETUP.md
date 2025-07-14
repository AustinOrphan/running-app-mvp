# SSL/TLS Certificate Setup Guide

This guide covers setting up SSL/TLS certificates for secure HTTPS communication in the running app.

## 📋 Prerequisites

- OpenSSL installed on your system
- Node.js and npm installed
- Domain name (for production certificates)

## 🔧 Development Setup

### Self-Signed Certificates (Development Only)

For local development, you can create self-signed certificates:

```bash
# Create certificates directory
mkdir -p certs

# Generate private key
openssl genrsa -out certs/key.pem 2048

# Generate certificate signing request
openssl req -new -key certs/key.pem -out certs/csr.pem

# Generate self-signed certificate
openssl x509 -req -days 365 -in certs/csr.pem -signkey certs/key.pem -out certs/cert.pem

# Generate DH parameters (optional, for enhanced security)
openssl dhparam -out certs/dhparam.pem 2048
```

### Environment Configuration

Update your `.env` file with SSL settings:

```bash
# Enable SSL
SSL_ENABLED=true

# Certificate paths
SSL_CERT_PATH=./certs/cert.pem
SSL_KEY_PATH=./certs/key.pem
SSL_DH_PARAM_PATH=./certs/dhparam.pem

# HTTPS configuration
HTTPS_PORT=443
REDIRECT_HTTP_TO_HTTPS=true
FORCE_HTTPS=true

# Security headers
HSTS_ENABLED=true
HSTS_MAX_AGE=31536000
CSP_ENABLED=true
```

## 🌍 Production Setup

### Let's Encrypt (Recommended)

For production, use Let's Encrypt for free SSL certificates:

```bash
# Install Certbot
sudo apt-get update
sudo apt-get install certbot

# Generate certificates (replace with your domain)
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Certificates will be saved to:
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem
```

### Production Environment Configuration

```bash
# SSL Configuration
SSL_ENABLED=true
SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem

# HTTPS Settings
HTTPS_PORT=443
REDIRECT_HTTP_TO_HTTPS=true
FORCE_HTTPS=true
TRUST_PROXY=true

# Enhanced Security
HSTS_ENABLED=true
HSTS_MAX_AGE=31536000
HSTS_INCLUDE_SUBDOMAINS=true
HSTS_PRELOAD=true

# Content Security Policy
CSP_ENABLED=true
CSP_REPORT_ONLY=false
```

### Certificate Auto-Renewal

Set up automatic renewal for Let's Encrypt certificates:

```bash
# Add to crontab
sudo crontab -e

# Add this line for auto-renewal (runs twice daily)
0 */12 * * * certbot renew --quiet --reload-hook "systemctl reload your-app-service"
```

## 🔒 Security Best Practices

### Certificate Validation

The application automatically validates certificates on startup:

- Checks if certificate files exist and are readable
- Validates certificate chains
- Monitors certificate expiry dates
- Logs security events

### Strong Cipher Configuration

Default cipher configuration prioritizes security:

```bash
# Strong ciphers (automatically configured)
SSL_CIPHERS=ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5
SSL_PROTOCOLS=TLSv1.2,TLSv1.3
SSL_HONOR_CIPHER_ORDER=true
```

### Security Headers

Enhanced security headers are automatically applied:

- **HSTS**: HTTP Strict Transport Security
- **CSP**: Content Security Policy
- **X-Frame-Options**: Clickjacking protection
- **X-Content-Type-Options**: MIME type sniffing protection
- **Referrer-Policy**: Referrer information control

## 📊 Monitoring and Debugging

### Security Endpoints (Development)

Monitor SSL/TLS configuration:

```bash
# Check security headers
curl -I https://localhost:443/api/debug/security-headers

# Check security metrics
curl https://localhost:443/api/debug/security-metrics
```

### Certificate Monitoring

The application automatically monitors certificates:

- Daily expiry checks
- Logs warnings 30 days before expiry
- Critical alerts 7 days before expiry

### Common Issues

1. **Certificate Not Found**
   - Verify file paths in environment variables
   - Check file permissions (readable by Node.js process)

2. **Certificate Expired**
   - Renew certificates using Let's Encrypt
   - Update certificate paths if changed

3. **Mixed Content Warnings**
   - Ensure all resources load over HTTPS
   - Check CSP configuration

4. **HSTS Issues**
   - Clear browser HSTS cache if testing
   - Verify HSTS headers are sent correctly

## 🚀 Deployment Considerations

### Reverse Proxy Setup (nginx)

If using nginx as reverse proxy:

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Strong SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

### Docker Deployment

For Docker deployments, mount certificates as volumes:

```dockerfile
# Mount certificates
VOLUME ["/app/certs"]

# Environment variables
ENV SSL_ENABLED=true
ENV SSL_CERT_PATH=/app/certs/cert.pem
ENV SSL_KEY_PATH=/app/certs/key.pem
```

### Cloud Deployment

For cloud deployments (AWS, GCP, Azure):

- Use cloud-managed certificates (AWS Certificate Manager, etc.)
- Configure load balancers for SSL termination
- Set `TRUST_PROXY=true` for proper header handling

## 📈 Performance Optimization

### HTTP/2 Support

Enable HTTP/2 for better performance:

```bash
# HTTP/2 is automatically enabled with HTTPS
# No additional configuration required
```

### Certificate Caching

Implement certificate caching for better performance:

- Cache certificates in memory
- Reload only when files change
- Use certificate monitoring for updates

## 🔍 Troubleshooting

### Debug SSL Issues

```bash
# Test SSL configuration
openssl s_client -connect localhost:443 -servername localhost

# Check certificate details
openssl x509 -in certs/cert.pem -text -noout

# Verify certificate chain
openssl verify -CAfile certs/ca.pem certs/cert.pem
```

### Common Error Messages

1. **"SSL certificate validation failed"**
   - Check certificate file paths and permissions
   - Verify certificate format and validity

2. **"HTTPS redirect loop"**
   - Check `TRUST_PROXY` setting
   - Verify reverse proxy configuration

3. **"Certificate expired"**
   - Renew certificates
   - Check system date/time

For additional support, check the application logs for detailed SSL/TLS error messages.
