# LinkedIn Community Management API — Application Brief

Use this when applying for the **Community Management API** product on your LinkedIn app at https://www.linkedin.com/developers/apps

Once approved (typically 1–2 weeks), the Channels page will automatically detect the new permissions and unlock posting to the Roam Local company page.

---

## Application Form Answers

### What is your company/product?

**Roam Local** is a hyper-local discovery and travel app helping people find and connect with independent businesses, venues, and experiences in their area. We operate primarily in the UK with active communities in the North East of England, Northern Ireland, and expanding nationally.

Website: https://roam-local.co.uk

### What is your use case for the Community Management API?

We are building an internal CRM and growth platform (Roam Growth Engine) that allows our marketing team to schedule and publish content to our official LinkedIn company page (Roam Local) directly from our content calendar.

Use case in detail:
- Our team plans content in a unified social calendar across Facebook, Instagram, and LinkedIn
- Content is generated, reviewed, and approved internally by our marketing admins
- Approved posts are published to our **own** LinkedIn company pages (Roam Local UK, Roam NI, Roam for Business) on a scheduled basis
- We do not post to third-party pages, only to pages we administer

### Will you post on behalf of other organisations or only your own?

Only our own pages. All organisations posted to are owned and administered by Roam Local. Page admins explicitly authenticate via OAuth and can only see/post to pages where they have admin role.

### How frequently will you post?

3–7 posts per week per page across our company pages. Volume well within standard rate limits.

### What types of content?

- Local business spotlights (independent venues we feature in the app)
- Travel guides and destination content
- Product updates and feature launches
- Community events and partnerships
- Editorial content from our blog

### How do users authenticate?

Standard 3-legged OAuth 2.0 flow. Users:
1. Click "Connect LinkedIn" in our admin dashboard
2. Authenticate on LinkedIn's hosted page
3. Grant `r_organization_admin` and `w_organization_social` scopes
4. Are redirected back with an access token stored securely server-side

Only users with admin role on our company pages can post.

### Data handling

- Access tokens stored encrypted, scoped per-user
- No content is read from LinkedIn other than to confirm post success
- We do not scrape, store, or redistribute LinkedIn member data
- Users can disconnect at any time, revoking the token

### Compliance

- We have a privacy policy: https://roam-local.co.uk/privacy
- We comply with GDPR (UK-based company)
- Tokens are scoped only to the granted permissions
- No client-side exposure of credentials

---

## Submission Checklist

- [ ] Privacy policy URL is live and accessible
- [ ] LinkedIn app has the company logo uploaded
- [ ] App description matches the use case above
- [ ] Verified company page exists and is linked to the app
- [ ] OAuth redirect URLs are configured: `https://roam-crm-platform.netlify.app/api/auth/linkedin/callback`
- [ ] Privacy policy URL is set on the LinkedIn app settings page

## After Approval

When LinkedIn approves the Community Management API product:

1. Click "Reconnect" on the Channels page in the CRM
2. The OAuth flow will now also request `r_organization_admin` and `w_organization_social`
3. Your admin company pages appear automatically as connected
4. The Social Calendar account picker will show Roam Local as a posting target

No code changes needed — the system requests these scopes optimistically.
