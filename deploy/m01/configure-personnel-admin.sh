#!/bin/sh
set -eu

# Reconciles the dedicated Keycloak confidential service client used by the Hub
# personnel console. Runs inside the keycloak container via kcadm, driven by
# scripts/provision-m01-personnel-admin.ps1. It never creates business users,
# alters the browser OIDC client, or grants realm-admin.

client_secret="${M01_PERSONNEL_ADMIN_CLIENT_SECRET:-}"
if [ -z "$client_secret" ] || [ "$client_secret" = "__REPLACE_BEFORE_START__" ]; then
  echo "ERROR: M01_PERSONNEL_ADMIN_CLIENT_SECRET must be a generated value in deploy/m01/.env." >&2
  exit 1
fi

/opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null

client_id="aeos-hub-personnel-admin"
client_key="$(/opt/keycloak/bin/kcadm.sh get clients -r aeos -q clientId="$client_id" --fields id --format csv --noquotes | tail -n 1)"
if [ -z "$client_key" ]; then
  client_key="$(/opt/keycloak/bin/kcadm.sh create clients -r aeos \
    -s clientId="$client_id" \
    -s secret="$client_secret" \
    -s serviceAccountsEnabled=true \
    -s publicClient=false \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s 'description=AEOS Hub personnel administration service client (confidential)' \
    -i)"
else
  /opt/keycloak/bin/kcadm.sh update "clients/$client_key" -r aeos \
    -s secret="$client_secret" \
    -s serviceAccountsEnabled=true \
    -s publicClient=false \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false >/dev/null
fi
test -n "$client_key"

# Minimum realm-management permissions: manage/query users plus read-only realm
# role lookup. No realm-admin, no client/role/mapper/group management.
for role in query-users manage-users view-realm; do
  /opt/keycloak/bin/kcadm.sh add-roles -r aeos \
    --uusername "service-account-$client_id" \
    --cclientid realm-management \
    --rolename "$role" >/dev/null
done

echo "personnel-admin client reconciled"
