#!/bin/sh
set -eu

callback="https://${M01_HUB_EXTERNAL_HOSTNAME}:${M01_HUB_HTTPS_PORT}/api/auth/callback"
origin="https://${M01_HUB_EXTERNAL_HOSTNAME}:${M01_HUB_HTTPS_PORT}"
logout="${origin}/?logged_out=1"

/opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null

client_id="$(/opt/keycloak/bin/kcadm.sh get clients -r aeos -q clientId=aeos-hub-web --fields id --format csv --noquotes | tail -n 1)"
test -n "$client_id"

/opt/keycloak/bin/kcadm.sh update "clients/${client_id}" -r aeos -s "redirectUris=[\"${callback}\"]" >/dev/null
/opt/keycloak/bin/kcadm.sh update "clients/${client_id}" -r aeos -s "webOrigins=[\"${origin}\"]" >/dev/null
/opt/keycloak/bin/kcadm.sh update "clients/${client_id}" -r aeos -s "attributes.\"post.logout.redirect.uris\"=${logout}" >/dev/null
