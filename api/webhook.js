const fetch = require('node-fetch');

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const { type, data } = req.body;
        if (type !== 'payment') return res.status(200).json({ ok: true });

        const paymentId = data?.id;
        if (!paymentId) return res.status(200).json({ ok: true });

        // Get payment from MP
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
        });
        const payment = await mpRes.json();

        // Update Supabase order status
        const newStatus = payment.status === 'approved' ? 'aprovado'
            : payment.status === 'rejected' ? 'recusado'
            : payment.status === 'pending' ? 'pendente' : payment.status;

        await fetch(`${SUPABASE_URL}/rest/v1/pedidos?observacoes=like.*${paymentId}*`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus, status_pagamento: payment.status })
        });

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Webhook error:', err);
        return res.status(500).json({ error: err.message });
    }
};
