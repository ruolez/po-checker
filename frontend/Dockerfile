FROM nginx:alpine

# Copy static files
COPY public/ /usr/share/nginx/html/

# Custom nginx config for no caching
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    location / { \
        try_files $uri $uri/ /index.html; \
        add_header Cache-Control "no-store, no-cache, must-revalidate"; \
        add_header Pragma "no-cache"; \
        add_header Expires "0"; \
    } \
    \
    location ~* \.(css|js)$ { \
        add_header Cache-Control "no-store, no-cache, must-revalidate"; \
        add_header Pragma "no-cache"; \
        add_header Expires "0"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
