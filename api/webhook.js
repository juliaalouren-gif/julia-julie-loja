
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

const { sendWhatsAppConfirmation, emitBlingNfe } = require('./_shared');

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
        const detail = payment.status_detail || '';
        const isExpired = detail.includes('expir') || detail === 'pix_expiration_date_expired';
        const newStatus = payment.status === 'approved' ? 'aprovado'
            : payment.status === 'rejected' && isExpired ? 'expirado'
            : payment.status === 'rejected' ? 'recusado'
            : payment.status === 'pending' ? 'pendente' : payment.status;

        // Look up the order(s) BEFORE updating, so we know whether this is the
        // first time this payment is becoming 'aprovado'. Mercado Pago retries
        // webhooks, and we only want the confirmation sent once. Note: for
        // instantly-approved payments (credit card), process-payment.js already
        // saves the order as 'aprovado' and fires the notifications itself -
        // this check is what prevents firing them a second time here.
        const findRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?observacoes=like.*${paymentId}*&select=id,status,nome,telefone,email,cpf,cep,rua,numero,complemento,bairro,cidade,estado,kit,quantidade,tamanho,total,forma_pagamento`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        const orders = await findRes.json();
        const shouldNotify = newStatus === 'aprovado' && Array.isArray(orders)
            && orders.some(o => o.status !== 'aprovado');

        await fetch(`${SUPABASE_URL}/rest/v1/pedidos?observacoes=like.*${paymentId}*`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus, status_pagamento: payment.status })
        });

        if (shouldNotify) {
            for (const order of orders) {
                await sendWhatsAppConfirmation(order);
                await emitBlingNfe(order);
            }
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Webhook error:', err);
        return res.status(500).json({ error: err.message });
    }
};
