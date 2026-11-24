/**
 * Stylesheet for the studio pages (inlined in a <style> element; no external CSS, fonts or JS).
 * Brand: near-black #0B0C0F, off-white #F4F6F8, teal #29B8AD. Measured contrast on the page
 * background: text 18:1, muted 12:1, teal 8:1, error 8.6:1, input borders 4:1 (on cards 4.9:1).
 */
export const STUDIO_CSS = `
:root{--bg:#0B0C0F;--surface:#161A21;--text:#F4F6F8;--muted:#C9CED6;--line:#808894;--rule:#2A303A;--accent:#29B8AD;--accent-hover:#4FCFC5;--error:#FF9B8F;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:1rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
a{color:var(--accent);text-underline-offset:.15em}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
h1,h2,h3{line-height:1.2;margin:0 0 .75rem;text-wrap:balance}
h1{font-size:clamp(2rem,6vw,3.25rem);letter-spacing:-.02em}
h2{font-size:clamp(1.5rem,4vw,2rem);letter-spacing:-.01em}
h3{font-size:1.125rem}
p{margin:0 0 1rem}
.wrap{width:min(100% - 2rem,64rem);margin-inline:auto}
.narrow{max-width:42rem}
.skip{position:absolute;left:1rem;top:-10rem;z-index:10;padding:.75rem 1rem;border-radius:8px;background:var(--accent);color:var(--bg);font-weight:700}
.skip:focus{top:1rem}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
main:focus{outline:none}
header.site{border-bottom:1px solid var(--rule)}
header.site .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem 1.5rem;padding-block:.75rem}
.brand{display:inline-flex;align-items:center;min-height:44px;color:var(--text);font-weight:750;text-decoration:none}
.brand span{color:var(--accent);margin-left:.3em}
nav ul{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem 1.25rem;margin:0;padding:0;list-style:none}
nav a{display:inline-flex;align-items:center;min-height:44px;color:var(--text)}
main>section{padding-block:clamp(2.5rem,7vw,4.5rem)}
main>section+section{border-top:1px solid var(--rule)}
.hero{padding-block:clamp(3rem,10vw,6.5rem)}
.eyebrow{margin-bottom:1rem;color:var(--accent);font-size:.9rem;font-weight:650;letter-spacing:.06em;text-transform:uppercase}
.lede{max-width:44rem;color:var(--muted);font-size:clamp(1.05rem,2.4vw,1.25rem)}
.section-lede{max-width:44rem;color:var(--muted)}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.75rem}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.7rem 1.3rem;border:2px solid var(--accent);border-radius:999px;background:var(--accent);color:var(--bg);font:inherit;font-weight:700;text-align:center;text-decoration:none;cursor:pointer}
.btn:hover{border-color:var(--accent-hover);background:var(--accent-hover)}
.btn-ghost{border-color:var(--line);background:transparent;color:var(--text)}
.btn-ghost:hover{border-color:var(--text);background:var(--surface)}
nav .btn{min-height:44px;padding:.45rem 1rem;color:var(--bg)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:1rem;margin:0;padding:0;list-style:none}
.card{padding:1.25rem;border:1px solid var(--rule);border-radius:16px;background:var(--surface)}
.card>:last-child{margin-bottom:0}
.muted,.hint{color:var(--muted)}
.hint{margin:.1rem 0 .5rem;font-size:.92rem}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:1rem;margin:0;padding:0;list-style:none;counter-reset:step}
.steps li{position:relative;padding:1.25rem 1.25rem 1.25rem 4rem;border:1px solid var(--rule);border-radius:16px;background:var(--surface);counter-increment:step}
.steps li::before{content:counter(step);position:absolute;left:1.15rem;top:1.15rem;display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;background:var(--accent);color:var(--bg);font-weight:750}
.steps p{margin:0;color:var(--muted)}
.package{display:flex;flex-direction:column}
.package h4{margin:.25rem 0 .5rem;color:var(--muted);font-size:.85rem;letter-spacing:.06em;text-transform:uppercase}
.ticks{margin:0;padding-left:1.2rem}
.ticks li{margin-bottom:.35rem}
.facts{display:grid;gap:.5rem;margin:1rem 0}
.facts div{display:flex;justify-content:space-between;gap:1rem;padding-top:.5rem;border-top:1px solid var(--rule)}
.facts dt{color:var(--muted)}
.facts dd{margin:0;font-weight:650;text-align:right}
.card-actions{display:grid;gap:.5rem;margin-top:auto;padding-top:.5rem}
.faq{max-width:46rem}
.faq details{padding:.25rem 0;border-top:1px solid var(--rule)}
.faq details:last-child{border-bottom:1px solid var(--rule)}
.faq summary{display:flex;align-items:center;min-height:44px;padding:.5rem 0;font-weight:650;cursor:pointer}
.faq details p{color:var(--muted)}
.terms{max-width:46rem;padding-left:1.25rem}
.terms li{margin-bottom:.75rem}
.order-box{max-width:44rem;padding:clamp(1.25rem,4vw,2rem);border:1px solid var(--rule);border-radius:18px;background:var(--surface)}
.field{margin-bottom:1.25rem}
.field>label{display:block;margin-bottom:.2rem;font-weight:650}
.optional{color:var(--muted);font-weight:400}
input[type=text],input[type=email],input[type=date],select,textarea{display:block;width:100%;min-height:48px;padding:.65rem .8rem;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text);font:inherit}
textarea{min-height:10rem;resize:vertical}
.has-error input,.has-error select,.has-error textarea{border:2px solid var(--error)}
.field-error{margin:.2rem 0 .5rem;color:var(--error);font-weight:650}
.check{display:grid;grid-template-columns:1.5rem 1fr;gap:.75rem;align-items:start}
.check input{width:1.4rem;height:1.4rem;margin:.15rem 0 0;accent-color:var(--accent)}
.error-summary{margin-bottom:1.5rem;padding:1rem 1.25rem;border:2px solid var(--error);border-radius:12px}
.error-summary h2{font-size:1.25rem;margin-bottom:.5rem}
.error-summary ul{margin:0;padding-left:1.2rem}
.error-summary a{color:var(--error);font-weight:650}
.callout{margin:1.5rem 0;padding:1rem 1.25rem;border-left:4px solid var(--accent);border-radius:0 12px 12px 0;background:var(--surface)}
.callout h2{font-size:1.25rem}
.hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}
footer.site{padding-block:2rem;border-top:1px solid var(--rule);color:var(--muted);font-size:.95rem}
footer.site p{margin:0 0 .5rem}
@media (forced-colors:active){.btn{border:2px solid ButtonText}.steps li::before{border:1px solid CanvasText}}
`;
