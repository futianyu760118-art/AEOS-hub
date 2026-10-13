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

# The Hub can only assign roles which exist in the realm. Reconcile the three
# protected pilot roles before the service account or the Hub manages users.
# Do not alter an existing role: its membership and any Keycloak metadata stay
# intact.
for role in manager operator owner; do
  if ! /opt/keycloak/bin/kcadm.sh get "roles/$role" -r aeos >/dev/null 2>&1; then
    /opt/keycloak/bin/kcadm.sh create roles -r aeos \
      -s "name=$role" \
      -s "description=AEOS Hub protected pilot role: $role" >/dev/null
  fi
done

# Minimum built-in realm-management permissions for scoped user administration
# and Hub business-role lifecycle. Never grant realm-admin.
# role lookup. No realm-admin, no client/role/mapper/group management.
for role in query-users manage-users view-realm manage-realm; do
  /opt/keycloak/bin/kcadm.sh add-roles -r aeos \
    --uusername "service-account-$client_id" \
    --cclientid realm-management \
    --rolename "$role" >/dev/null
done

# The employee-facing Account Console must not become a second source of truth
# for tenant/organization/OA attributes. ADMIN_EDIT allows Hub and OA sync to
# maintain unlisted attributes through the Admin API, while users cannot see or
# edit them. The standard fields below are deliberately optional and admin-only.
profile_file="/opt/aeos/aeos-user-profile.json"
test -r "$profile_file"
/opt/keycloak/bin/kcadm.sh update users/profile -r aeos -f "$profile_file" >/dev/null

echo "personnel-admin client and employee user profile reconciled"
