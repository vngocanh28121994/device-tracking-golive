# Account avatars

Users can upload JPEG, PNG or WebP images up to 5 MB from their profile. The browser crops to a centered 192px square JPEG before saving. The server accepts only JPEG payloads up to 64 KB, stores objects in R2 and keeps the object key in D1.

Only the signed-in account can edit its own profile. Image reads require authentication and an active profile reference. Replacing or removing an image invalidates its previous URL.

Device holders use stable account IDs for photos. Legacy holders resolve by name only when one account matches. Free-text borrowers retain initials.
