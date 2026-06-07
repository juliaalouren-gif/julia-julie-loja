
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const {
            paymentMethod, // 'pix' | 'card'
            token,         // card token (card only)
            installments,  // card only
            // order data
            nome, email, telefone, cpf,
            cep, rua, numero, complemento, bairro, cidade, estado,
            tipo_frete, prazo_frete, custo_frete,
            kit, nome_kit, quantidade, tamanho, cor,
            subtotal, desconto, total
        } = req.body;

        // --- Build MP payment body ---
        const cpfClean = (cpf || '').replace(/\D/g, '');
        const telClean = (telefone || '').replace(/\D/g, '');

        const mpBody = {
            transaction_amount: parseFloat(total),
            description: `${nome_kit} - Julia & Julie`,
            payment_method_id: paymentMethod === 'pix' ? 'pix' : undefined,
            token: paymentMethod === 'card' ? token : undefined,
            installments: paymentMethod === 'card' ? (parseInt(installments) || 1) : undefined,
            payer: {
                email,
                first_name: nome.split(' ')[0],
                last_name:  nome.split(' ').slice(1).join(' ') || nome.split(' ')[0],
                identification: { type: 'CPF', number: cpfClean },
                phone: { area_code: telClean.slice(0,2), number: telClean.slice(2) },
                address: { zip_code: cep, street_name: rua, street_number: numero }
            },
            notification_url: `${process.env.SITE_URL}/api/webhook`,
            external_reference: `jj-${Date.now()}`
        };

        // Remove undefined fields
        Object.keys(mpBody).forEach(k => mpBody[k] === undefined && delete mpBody[k]);

        // --- Call Mercado Pago API ---
        const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': `jj-${Date.now()}-${Math.random()}`
            },
            body: JSON.stringify(mpBody)
        });

        const mpData = await mpRes.json();

        if (!mpRes.ok) {
            console.error('MP Error:', mpData);
            return res.status(400).json({ error: mpData.message || 'Erro no pagamento', detail: mpData });
        }

        // --- Save order to Supabase ---
        const orderData = {
            status: mpData.status === 'approved' ? 'aprovado' : 'pendente',
            nome, email, telefone, cpf,
            cep, rua, numero, complemento, bairro, cidade, estado,
            tipo_frete, prazo_frete,
            custo_frete: parseFloat(custo_frete) || 0,
            kit, nome_kit,
            quantidade: parseInt(quantidade) || 1,
            tamanho, cor,
            forma_pagamento: paymentMethod === 'pix' ? 'PIX' : 'Cartão de Crédito',
            status_pagamento: mpData.status,
            subtotal: parseFloat(subtotal) || 0,
            desconto: parseFloat(desconto) || 0,
            total: parseFloat(total),
            observacoes: `MP ID: ${mpData.id}`
        };

        await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(orderData)
        });

        // --- Return result ---
        const response = {
            id: mpData.id,
            status: mpData.status,
            status_detail: mpData.status_detail
        };

        if (paymentMethod === 'pix' && mpData.point_of_interaction) {
            response.pix_qr_code = mpData.point_of_interaction.transaction_data?.qr_code;
            response.pix_qr_code_base64 = mpData.point_of_interaction.transaction_data?.qr_code_base64;
        }

        return res.status(200).json(response);

    } catch (err) {
        console.error('Server error:', err);
        return res.status(500).json({ error: err.message });
    }
};
