// ============================================================
// STRIPE CONFIG — Replace with your real keys from stripe.com
// ============================================================
const STRIPE_PUBLISHABLE_KEY = 'pk_test_REPLACE_WITH_YOUR_KEY';
// ============================================================

// Read order data from URL params (set by index.html Buy Now button)
const params    = new URLSearchParams(window.location.search);
const promoType = params.get('promo') || 'B';        // 'A' = Buy1Get2, 'B' = Buy2Get4
const kitQty    = parseInt(params.get('kits') || '1');
const prices    = { A: 32.90, B: 49.90 };
const labels    = { A: 'Buy 1, Get 2', B: 'Buy 2, Get 4' };
const brasPerKit = { A: 2, B: 4 };

let shippingCost   = 0;
let discountAmount = 0;
let orderTotal     = prices[promoType] * kitQty;
let stripeObj      = null;
let stripeElements = null;
let currentStep    = 'info';

// ── Init order summary panel ──────────────────────────────
function initSummary() {
    const totalBras = brasPerKit[promoType] * kitQty;
    const label     = `${labels[promoType]} · ${kitQty} kit${kitQty > 1 ? 's' : ''}`;
    const price     = '$' + (prices[promoType] * kitQty).toFixed(2);

    // Right panel
    setEl('badge-qty', totalBras);
    setEl('item-var',  label);
    setEl('item-p',    price);

    updateTotals();
}

function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function updateTotals() {
    const sub   = prices[promoType] * kitQty;
    const total = Math.max(0, sub + shippingCost - discountAmount);

    setEl('r-subtotal', '$' + sub.toFixed(2));
    setEl('r-total',    '$' + total.toFixed(2));
    setEl('mob-total',  '$' + total.toFixed(2));

    const shippingEl = document.getElementById('r-shipping');
    if (shippingEl) {
        if (shippingCost === 0) {
            shippingEl.textContent  = currentStep === 'info' ? 'Calculated at next step' : 'Free';
            shippingEl.className    = 'co-muted';
        } else {
            shippingEl.textContent = '$' + shippingCost.toFixed(2);
            shippingEl.className   = '';
        }
    }

    orderTotal = total;
}

// ── Shipping cost update ──────────────────────────────────
function updateShipping(cost) {
    shippingCost = cost;

    // Update pill-method text
    const methodEl = document.getElementById('pill-method');
    if (methodEl) {
        methodEl.textContent = cost === 0
            ? 'Standard Shipping · Free'
            : 'Express Shipping · $9.99';
    }

    updateTotals();
}

// ── Discount code ──────────────────────────────────────────
const DISCOUNT_CODES = { 'JULIA10': 0.10, 'WELCOME15': 0.15, 'SAVE20': 0.20 };

function applyDiscount() {
    const input = document.getElementById('disc-code');
    if (!input) return;
    const code = input.value.trim().toUpperCase();

    if (DISCOUNT_CODES[code]) {
        const pct   = DISCOUNT_CODES[code];
        discountAmount = (prices[promoType] * kitQty) * pct;

        setEl('r-discount', '-$' + discountAmount.toFixed(2));
        const row = document.getElementById('r-discount-row');
        if (row) row.classList.remove('hidden');
        updateTotals();
    } else {
        alert('Invalid discount code. Try JULIA10, WELCOME15 or SAVE20.');
    }
}

// ── Step navigation ────────────────────────────────────────
const STEP_IDS  = { info: 'step-info', shipping: 'step-shipping', payment: 'step-payment' };
const CRUMB_IDS = { cart: 'crumb-cart', info: 'crumb-info', shipping: 'crumb-shipping', payment: 'crumb-payment' };
const STEP_ORDER = ['info', 'shipping', 'payment'];

function goToStep(step) {
    // Validate before advancing
    if (step === 'shipping' && currentStep === 'info') {
        const email = (document.getElementById('email') || {}).value || '';
        if (!email.trim() || !email.includes('@')) {
            alert('Please enter a valid email address.'); return;
        }
        // Populate pills
        setEl('pill-email',  email.trim());
        setEl('pill-email2', email.trim());
        const addr = buildAddressString();
        setEl('pill-address',  addr);
        setEl('pill-address2', addr);
    }

    if (step === 'payment' && currentStep === 'shipping') {
        // Update shipping method pill (already done in updateShipping)
        updateTotals();
    }

    // Hide all steps
    Object.values(STEP_IDS).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    // Show target step
    const target = document.getElementById(STEP_IDS[step]);
    if (target) target.classList.remove('hidden');

    // Update breadcrumb
    const currentIdx = STEP_ORDER.indexOf(step);

    STEP_ORDER.forEach((s, i) => {
        const crumb = document.getElementById('crumb-' + s);
        if (!crumb) return;
        crumb.className = 'crumb';
        if (s === step)           crumb.classList.add('active');
        else if (i < currentIdx)  crumb.classList.add('done');
        else                      crumb.classList.add('inactive');
    });

    currentStep = step;
    if (step === 'payment') initStripe();

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildAddressString() {
    const f   = v => (document.getElementById(v) || {}).value || '';
    const apt = f('apt') ? `, ${f('apt')}` : '';
    return `${f('address')}${apt}, ${f('city')}, ${f('state')} ${f('zip')}`.replace(/^,\s|,\s$/, '').trim();
}

// ── Billing toggle ─────────────────────────────────────────
function toggleBilling(showFields) {
    const fields = document.getElementById('billing-fields');
    const sameLabel = document.getElementById('billing-same-label');
    const diffLabel = document.getElementById('billing-diff-label');
    if (fields)     fields.classList.toggle('hidden', !showFields);
    if (sameLabel)  sameLabel.classList.toggle('active', !showFields);
    if (diffLabel)  diffLabel.classList.toggle('active', showFields);
}

// ── Mobile summary toggle ──────────────────────────────────
function toggleMobileSummary() {
    const panel   = document.getElementById('mob-panel');
    const label   = document.getElementById('mob-toggle-label');
    const chevron = document.getElementById('mob-chevron');
    if (!panel) return;

    const isOpen = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', isOpen);
    if (label)   label.textContent = isOpen ? 'Show order summary' : 'Hide order summary';
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';

    // Populate mobile panel if opening
    if (!isOpen) populateMobilePanel();
}

function populateMobilePanel() {
    const panel = document.getElementById('mob-panel');
    if (!panel) return;
    const right = document.querySelector('.co-summary');
    if (right) panel.innerHTML = right.innerHTML;
}

// ── Stripe ─────────────────────────────────────────────────
async function initStripe() {
    if (stripeElements) return;

    const container = document.getElementById('payment-element');
    if (!container) return;

    if (STRIPE_PUBLISHABLE_KEY === 'pk_test_REPLACE_WITH_YOUR_KEY') {
        container.innerHTML = `
            <div style="padding:20px;background:#fff8f0;border-radius:8px;border:1.5px dashed #f5c98a;color:#7a4a00;font-size:13px;line-height:1.6;">
                <strong>⚙️ Stripe not connected yet.</strong><br>
                Replace <code>STRIPE_PUBLISHABLE_KEY</code> in <code>checkout.js</code> and
                <code>SECRET_KEY</code> in <code>server.js</code> with your keys from
                <a href="https://dashboard.stripe.com/apikeys" target="_blank" style="color:#c97b9a;">dashboard.stripe.com</a>.
                Then run <code>npm start</code>.
            </div>`;
        return;
    }

    stripeObj = Stripe(STRIPE_PUBLISHABLE_KEY);

    try {
        const res = await fetch('/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: Math.round(orderTotal * 100), currency: 'usd' })
        });
        const { clientSecret, error } = await res.json();
        if (error) throw new Error(error);

        stripeElements = stripeObj.elements({
            clientSecret,
            appearance: {
                theme: 'stripe',
                variables: {
                    colorPrimary: '#c97b9a',
                    colorBackground: '#ffffff',
                    colorText: '#333333',
                    borderRadius: '8px',
                    fontFamily: 'Poppins, sans-serif'
                }
            }
        });

        stripeElements.create('payment').mount('#payment-element');
    } catch (err) {
        container.innerHTML = `<p style="color:#c0392b;font-size:13px;padding:12px;">
            Could not connect to payment server. Make sure <code>server.js</code> is running (<code>npm start</code>).
        </p>`;
    }
}

// ── Handle payment submit ──────────────────────────────────
async function handlePayment() {
    if (!stripeObj || !stripeElements) return;

    const btn     = document.getElementById('pay-btn');
    const text    = document.getElementById('pay-text');
    const spinner = document.getElementById('pay-spinner');
    const errEl   = document.getElementById('payment-error');

    btn.disabled      = true;
    text.textContent  = 'Processing…';
    spinner.classList.remove('hidden');
    if (errEl) errEl.classList.add('hidden');

    const { error } = await stripeObj.confirmPayment({
        elements: stripeElements,
        confirmParams: {
            return_url: window.location.origin + '/success.html',
            receipt_email: (document.getElementById('email') || {}).value || '',
            shipping: {
                name: `${(document.getElementById('firstName') || {}).value || ''} ${(document.getElementById('lastName') || {}).value || ''}`.trim(),
                address: {
                    line1:       (document.getElementById('address') || {}).value || '',
                    line2:       (document.getElementById('apt')     || {}).value || '',
                    city:        (document.getElementById('city')    || {}).value || '',
                    state:       (document.getElementById('state')   || {}).value || '',
                    postal_code: (document.getElementById('zip')     || {}).value || '',
                    country:     (document.getElementById('country') || {}).value || 'US'
                }
            }
        }
    });

    if (error) {
        if (errEl) { errEl.textContent = error.message; errEl.classList.remove('hidden'); }
        const msg = document.getElementById('payment-message');
        if (msg) { msg.textContent = error.message; msg.classList.remove('hidden'); }
        btn.disabled     = false;
        text.textContent = 'Pay now';
        spinner.classList.add('hidden');
    }
}

// ── Init ───────────────────────────────────────────────────
initSummary();
