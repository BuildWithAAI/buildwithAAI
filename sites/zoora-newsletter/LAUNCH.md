# Zoora public newsletter page

Static interest page for the existing Netlify site. It replaces the published page that saved an address in `localStorage` under `zoora-newsletter` and told the visitor that nothing was mailed. This folder does not deploy, create a Netlify project, change DNS, send mail, or alter Railway or the platform app.

Rechecked 9 November 2026 (America/Chicago): `https://zoora-oh1r.netlify.app` still served that older page from site `zoora-oh1r`, id `26388513-a228-4ec3-acb9-8115c563f787`. Netlify Forms was already enabled for a form named `newsletter` with an email field. The site has no Git connection and is updated by manual upload. Publishing this directory replaces the files on that same site. It does not, by itself, prove the custom domain `zoora.ai` is attached.

## Publish directory

Upload the contents of this directory as the site root:

`sites/zoora-newsletter/public`

Files:

| File | Role |
| --- | --- |
| `index.html` | Landing page and form |
| `success.html` | Page shown after Netlify accepts the POST |
| `style.css` | Shared styles |
| `favicon.svg` | Site icon |

The deploy-ready archive is `zoora_newsletter_public.zip`. Its four files sit at the archive root. Unpack it and upload those files as the existing site root. Do not upload `LAUNCH.md`.

## Form

The form is static HTML so Netlify can detect it at deploy time. There is no script and no `localStorage`.

- Form `name`: `newsletter`
- Method: `POST`
- Action: `/success.html`
- Detection: `data-netlify="true"` and the `netlify` attribute
- Hidden field: `form-name` = `newsletter`
- Address field: `email` (`type="email"`, required)
- Consent field: `consent` = `yes` when checked (required)
- Honeypot: `netlify-honeypot="bot-field"` and an unfilled `bot-field` input

After a manual production deploy, the existing `newsletter` form should keep receiving submissions. The extra `consent` value is stored with the submission. This repository does not turn on Netlify email notifications. The page states that it does not send email. A stored submission is not a delivered message and is not a product launch.

## Manual upload only

Use the existing site. Do not run `netlify sites:create`, connect a Git repository, change a domain, or edit another site.

Example, for a machine already logged into the Netlify account that owns this site. This command is not part of the change and was not run here:

```bash
netlify deploy --prod --site 26388513-a228-4ec3-acb9-8115c563f787 --dir sites/zoora-newsletter/public
```

Equivalent manual API upload: zip the files inside `sites/zoora-newsletter/public` (not the parent folder) and deploy that archive to site `26388513-a228-4ec3-acb9-8115c563f787`.

Check after deploy, without using a personal address:

- `GET /` returns the new page, with the form present in the HTML.
- `GET /success.html` returns the receipt page.
- Netlify’s form UI lists `newsletter`.
- A real signup is an owner action. Do not post a personal or test inbox from CI.

## What this page says

Zoora is building tools for people and AI agents to work together. Visitors can sign up for product and build updates. The copy does not offer a token purchase, a wallet connection, a price, a profit, or a trade, and it does not say a product has launched.

## Checks recorded with the source

`python -m unittest tests.test_zoora_newsletter_page` reads the static files only. It checks form name, POST, Netlify attributes, honeypot, email and consent labels, the success page, reduced-motion CSS, and contrast. It does not submit the form.
