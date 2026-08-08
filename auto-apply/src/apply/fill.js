// Shared form-filling helpers used by the Greenhouse and Lever appliers.
// Strategy: enumerate visible form fields, match each label against known
// patterns from the profile, fill what we recognize, and report anything
// we don't so the job can be flagged for manual review instead of guessing.

const FIELD_PATTERNS = (p) => [
  { re: /first\s*name/i, value: p.personal.firstName },
  { re: /last\s*name|surname|family\s*name/i, value: p.personal.lastName },
  { re: /full\s*name|^name$|your\s*name/i, value: `${p.personal.firstName} ${p.personal.lastName}` },
  { re: /e-?mail/i, value: p.personal.email },
  { re: /phone|mobile/i, value: p.personal.phone },
  { re: /linkedin/i, value: p.personal.linkedin },
  { re: /github/i, value: p.personal.github },
  { re: /website|portfolio|personal\s*site/i, value: p.personal.website },
  { re: /location|city|current\s*address|where.*(located|based)/i, value: p.personal.location },
  { re: /salary|compensation|pay\s*expectation/i, value: p.answers?.salary },
  { re: /start\s*date|when.*start|available/i, value: p.answers?.startDate },
  { re: /how\s*did\s*you\s*hear|referral\s*source/i, value: p.answers?.howDidYouHear },
  { re: /why.*(company|role|join|interested)/i, value: p.answers?.whyThisCompany },
  { re: /years?\s*of\s*experience/i, value: p.answers?.yearsOfExperience },
  { re: /pronouns/i, value: '' },
];

export function matchField(labelText, profile) {
  for (const { re, value } of FIELD_PATTERNS(profile)) {
    if (re.test(labelText)) return value ?? null;
  }
  // Custom overrides: profile.answers.custom = { "regex or substring": "answer" }
  for (const [key, value] of Object.entries(profile.answers?.custom || {})) {
    try {
      if (new RegExp(key, 'i').test(labelText)) return value;
    } catch {
      if (labelText.toLowerCase().includes(key.toLowerCase())) return value;
    }
  }
  return undefined; // unrecognized — caller decides whether that's blocking
}

export async function detectCaptcha(page) {
  const sel = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, [data-sitekey]';
  return (await page.locator(sel).count()) > 0;
}

// Fill every text-like input/textarea on the page whose label we can resolve.
// Returns { filled: [...], unknown: [...] } where unknown lists required
// fields we could not answer.
export async function fillKnownFields(page, profile, { formSelector = 'form' } = {}) {
  const filled = [];
  const unknown = [];

  const fields = page.locator(`${formSelector} input[type="text"], ${formSelector} input[type="email"], ${formSelector} input[type="tel"], ${formSelector} input[type="url"], ${formSelector} input:not([type]), ${formSelector} textarea`);
  const count = await fields.count();

  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false))) continue;
    if (await field.inputValue().catch(() => '')) continue; // already filled (e.g. by resume parse)

    const label = await resolveLabel(page, field);
    if (!label) continue;

    const value = matchField(label, profile);
    if (value === undefined) {
      const required = await isRequired(field, label);
      if (required) unknown.push(label.trim());
      continue;
    }
    if (value === null || value === '') continue;
    await field.fill(String(value)).catch(() => unknown.push(label.trim()));
    filled.push(label.trim());
  }

  return { filled, unknown };
}

async function resolveLabel(page, field) {
  const id = await field.getAttribute('id');
  if (id) {
    const safe = id.replace(/"/g, '\\"');
    const byFor = page.locator(`label[for="${safe}"]`).first();
    if (await byFor.count()) return (await byFor.innerText().catch(() => '')) || null;
  }
  const aria = await field.getAttribute('aria-label');
  if (aria) return aria;
  const placeholder = await field.getAttribute('placeholder');
  if (placeholder) return placeholder;
  const name = await field.getAttribute('name');
  if (name) return name.replace(/[_\-\[\]]/g, ' ');
  return null;
}

async function isRequired(field, label) {
  if ((await field.getAttribute('required')) !== null) return true;
  if ((await field.getAttribute('aria-required')) === 'true') return true;
  return /\*/.test(label);
}
