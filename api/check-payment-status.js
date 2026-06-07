
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { payment_id } = req.query;
    if (!payment_id) return res.status(400).json({ error: 'payment_id required' });

    try {
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
            headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
        });
        const payment = await mpRes.json();

        if (payment.status === 'approved') {
            // Atualiza Supabase
            await fetch(`${SUPABASE_URL}/rest/v1/pedidos?observacoes=like.*${payment_id}*`, {
                method: 'PATCH',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'aprovado', status_pagamento: 'approved' })
            });
        }

        return res.status(200).json({ status: payment.status });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
