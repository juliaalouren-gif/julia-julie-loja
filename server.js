// ============================================================
// STRIPE BACKEND — Node.js + Express
// Replace SECRET_KEY with your real key from stripe.com
// ============================================================
const SECRET_KEY = 'sk_test_REPLACE_WITH_YOUR_SECRET_KEY';
// ============================================================

const express = require('express');
const stripe  = require('stripe')(SECRET_KEY);
const path    = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Create Payment Intent
app.post('/create-payment-intent', async (req, res) => {
    try {
        const { amount, currency } = req.body;
        const paymentIntent = await stripe.paymentIntents.create({
            amount,       // in cents
            currency,
            automatic_payment_methods: { enabled: true }
        });
        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n✅ Julia & Julie checkout server running at http://localhost:${PORT}`);
    console.log(`   Open: http://localhost:${PORT}/index.html\n`);
});
