-- RFC 7591 dynamic client registration is an unauthenticated request by
-- design, so a dynamically registered client has no creating user until a
-- human consents at the authorize endpoint. The user binding that carries
-- authority lives on oauth_authorization_codes.userId and
-- oauth_access_tokens.userId, not here; this column is provenance only.
--
-- Widening only: every existing row keeps its creator.
ALTER TABLE "external_clients" ALTER COLUMN "createdByUserId" DROP NOT NULL;
