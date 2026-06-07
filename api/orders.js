
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const DASH_PASSWORD = process.env.DASHBOARD_PASSWORD || 'JuliaJulie2026';
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-password');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const pwd = req.headers['x-dashboard-password'];
    if (pwd !== DASH_PASSWORD) return res.status(401).json({ error: 'Não autorizado' });

    // Sync pending payments
    if (req.method === 'POST' && req.body?.action === 'sync') {
        try {
            const pendRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?status_pagamento=eq.pending&select=id,observacoes`, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
            });
            const pending = await pendRes.json();

            for (const order of pending) {
                const mpId = (order.observacoes || '').replace('MP ID: ', '').trim();
                if (!mpId || isNaN(mpId)) continue;
                const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpId}`, {
                    headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
                });
                const payment = await mpRes.json();
                if (payment.status && payment.status !== 'pending') {
                    const newStatus = payment.status === 'approved' ? 'aprovado' : payment.status === 'rejected' ? 'recusado' : payment.status;
                    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${order.id}`, {
                        method: 'PATCH',
                        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: newStatus, status_pagamento: payment.status })
                    });
                }
            }
            return res.status(200).json({ synced: pending.length });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // Fetch orders with filters
    const { de, ate, status, pagamento, busca } = req.query;
    let query = `${SUPABASE_URL}/rest/v1/pedidos?select=*&order=criado_em.desc`;

    if (de)       query += `&criado_em=gte.${de}T00:00:00`;
    if (ate)      query += `&criado_em=lte.${ate}T23:59:59`;
    if (status && status !== 'Todos') query += `&status=eq.${encodeURIComponent(status)}`;
    if (pagamento && pagamento !== 'Todos') query += `&forma_pagamento=eq.${encodeURIComponent(pagamento)}`;
    if (busca) query += `&or=(nome.ilike.*${encodeURIComponent(busca)}*,email.ilike.*${encodeURIComponent(busca)}*,telefone.ilike.*${encodeURIComponent(busca)}*)`;

    try {
        const r = await fetch(query, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Range': '0-999' }
        });
        const orders = await r.json();
        return res.status(200).json(Array.isArray(orders) ? orders : []);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
