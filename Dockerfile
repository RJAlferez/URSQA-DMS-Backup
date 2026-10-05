# =============================================================================
# URS-DMS — frontend runtime image
#
# The Vite bundle is built from the workspace with `npm --prefix client run
# build`; this image serves the resulting static SPA and proxies /api to the
# backend container. Keeping the runtime image independent of Alpine's npm
# registry avoids platform-specific package-install failures during local
# Docker startup.
# =============================================================================

FROM nginx:1.27-alpine

RUN rm /etc/nginx/conf.d/default.conf \
    && chown nginx:nginx /etc/nginx/conf.d
COPY deploy/nginx/nginx.conf /etc/nginx/conf.d/app.conf.template
COPY deploy/nginx/entrypoint.sh /usr/local/bin/nginx-entrypoint.sh
RUN chmod +x /usr/local/bin/nginx-entrypoint.sh

COPY client/dist /usr/share/nginx/html

# Run as non-root for safer container defaults
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/local/bin/nginx-entrypoint.sh"]
