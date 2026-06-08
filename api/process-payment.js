
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
            customerName, customerEmail, customerCpf, customerPhone,
            customerAddress, quantity, promo, totalPrice,
            paymentMethodId, cardToken, cardPaymentMethodId, installments,
            shippingMethod, shippingPrice, tamanho, cor
        } = req.body;

        const cpfClean = (customerCpf || '').replace(/\D/g, '');
        const telClean = (customerPhone || '').replace(/\D/g, '');
        const nameParts = (customerName || '').trim().split(' ');

        const isPix = paymentMethodId === 'pix';

        const amount = Math.round(parseFloat(totalPrice) * 100) / 100;
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Valor inválido: ' + totalPrice });
        }

        const mpBody = {
            transaction_amount: amount,
            description: `Julia & Julie - Kit ${promo} (${quantity} un)`,
            payment_method_id: isPix ? 'pix' : cardPaymentMethodId || 'visa',
            payer: {
                email: customerEmail,
                first_name: nameParts[0] || customerName,
                last_name: nameParts.slice(1).join(' ') || nameParts[0] || '',
                identification: { type: 'CPF', number: cpfClean },
                phone: { area_code: telClean.slice(0, 2), number: telClean.slice(2) },
                address: {
                    zip_code: (customerAddress?.cep || '').replace(/\D/g, ''),
                    street_name: customerAddress?.street || '',
                    street_number: customerAddress?.number || 'S/N'
                }
            },
            notification_url: `${process.env.SITE_URL}/api/webhook`,
            external_reference: `jj-${Date.now()}`
        };

        if (!isPix) {
            mpBody.token = cardToken;
            mpBody.installments = parseInt(installments) || 1;
        }

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
            return res.status(400).json({ error: mpData.message || 'Erro no pagamento' });
        }

        // Save order to Supabase
        const orderData = {
            status: mpData.status === 'approved' ? 'aprovado' : 'pendente',
            nome: customerName,
            email: customerEmail,
            telefone: customerPhone,
            cpf: customerCpf,
            cep: customerAddress?.cep || '',
            rua: customerAddress?.street || '',
            numero: customerAddress?.number || '',
            complemento: customerAddress?.complement || '',
            bairro: customerAddress?.neighborhood || '',
            cidade: customerAddress?.city || '',
            estado: customerAddress?.state || '',
            tipo_frete: shippingMethod || '',
            prazo_frete: '',
            custo_frete: parseFloat(shippingPrice) || 0,
            kit: promo,
            nome_kit: `Kit ${promo}`,
            quantidade: parseInt(quantity) || 1,
            tamanho: tamanho || '',
            cor: cor || '',
            forma_pagamento: isPix ? 'PIX' : 'Cartão de Crédito',
            status_pagamento: mpData.status,
            subtotal: parseFloat(totalPrice),
            desconto: 0,
            total: parseFloat(totalPrice),
            observacoes: `MP ID: ${mpData.id}`
        };

        try {
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
        } catch (dbErr) {
            console.error('Supabase save error:', dbErr);
        }

        // Response
        if (isPix && mpData.point_of_interaction) {
            return res.status(200).json({
                id: mpData.id,
                status: mpData.status,
                qr_code: mpData.point_of_interaction.transaction_data?.qr_code,
                qr_code_base64: mpData.point_of_interaction.transaction_data?.qr_code_base64
            });
        }

        return res.status(200).json({
            id: mpData.id,
            status: mpData.status,
            status_detail: mpData.status_detail
        });

    } catch (err) {
        console.error('Server error:', err);
        return res.status(500).json({ error: err.message });
    }
};
