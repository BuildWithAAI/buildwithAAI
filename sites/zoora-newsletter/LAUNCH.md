# Zoora public newsletter page

Static interest page for zoora.ai. GitHub Pages publishes `sites/zoora-newsletter/public`. This folder does not change Railway or the platform app. `LAUNCH.md` stays outside `public/` and is not part of the site.

The signup form POSTs `email_address` to Kit at `https://app.kit.com/forms/10168331/subscriptions`. The visitor is asked to confirm by email and can unsubscribe. This repository does not send that mail.

## Publish directory

`sites/zoora-newsletter/public`

| File | Role |
| --- | --- |
| `index.html` | Landing page and Kit form |
| `success.html` | On-site page at `/success.html` |
| `style.css` | Shared styles |
| `favicon.svg` | Site icon |
| `CNAME` | `zoora.ai` |

`.github/workflows/zoora-pages.yml` deploys that directory. It runs on a push to `main` when `sites/zoora-newsletter/public/**` changes, and when someone starts it with `workflow_dispatch`. The build job checks out the repo, configures Pages, and uploads `sites/zoora-newsletter/public`. The deploy job publishes that artifact to the `github-pages` environment.

Merging the workflow does not attach the domain by itself. Pages has to be enabled for this repository, and the custom domain has to be saved in the repository settings.

## Namecheap DNS

At Namecheap, for `zoora.ai`:

- A records on `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`.
- CNAME record for `www` pointing at `buildwithaai.github.io`.

In the repository: Settings → Pages. Set the custom domain to `zoora.ai` and turn on Enforce HTTPS. The `CNAME` file in the publish directory repeats `zoora.ai`. It is harmless when the domain is also set in Settings.

## What this page says

Zoora is building tools for people and AI agents to work together. Visitors can sign up for product and build updates. The copy does not offer a token purchase, a wallet connection, a price, a profit, or a trade, and it does not say a product has launched.

## Checks recorded with the source

`python -m unittest tests.test_zoora_newsletter_page` reads the static files only. It checks the Kit POST, the `email_address` field, consent, the success page, reduced-motion CSS, and contrast. It does not submit the form.
