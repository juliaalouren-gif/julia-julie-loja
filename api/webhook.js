
const MP_ACCESS_TOKEN    = process.env.MP_ACCESS_TOKEN;
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY;
const ZAPI_INSTANCE_ID   = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN         = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN  = process.env.ZAPI_CLIENT_TOKEN;
const BLING_CLIENT_ID     = process.env.BLING_CLIENT_ID;
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET;

// "Venda de mercadoria a não contribuinte" - natureza de operação padrão da conta Bling,
// usada pois todos os clientes da loja compram com CPF (consumidor final).
const BLING_NATUREZA_OPERACAO_ID = 15111369428;

// SKUs cadastrados no Bling para cada tamanho do Sutiã Sustentação Hanna.
const BLING_SKU_POR_TAMANHO = {
    'P': 'hanna/p', 'M': 'hanna/m', 'G': 'hanna/g', 'GG': 'hanna/gg',
    'XL': 'hanna/xl', '2XL': 'hanna/2xl', '3XL': 'hanna/3xl', '4XL': 'hanna/4xl'
};

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
        // webhooks, and we only want the WhatsApp confirmation sent once.
        const findRes = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?observacoes=like.*${paymentId}*&select=id,status,nome,telefone,email,cpf,cep,rua,numero,complemento,bairro,cidade,estado,kit,quantidade,tamanho,total`, {
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
                // WhatsApp ainda não ativado - aguardando confirmação da instância Z-API.
                // await sendWhatsAppConfirmation(order.nome, order.telefone);
                await emitBlingNfe(order);
            }
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Webhook error:', err);
        return res.status(500).json({ error: err.message });
    }
};

async function sendWhatsAppConfirmation(nome, telefone) {
    try {
        if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN || !telefone) return;

        let phone = String(telefone).replace(/\D/g, '');
        if (!phone.startsWith('55')) phone = '55' + phone;

        const primeiroNome = (nome || '').trim().split(' ')[0] || 'cliente';
        const message = `Olá ${primeiroNome}, seu pedido foi confirmado com sucesso e logo será processado e sairá para entrega. Prazo de entrega é de 14 dias.\n\nPara mais dúvidas chame o suporte pelo número: 21 97560-5337`;

        await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Client-Token': ZAPI_CLIENT_TOKEN
            },
            body: JSON.stringify({ phone, message })
        });
    } catch (err) {
        console.error('Z-API send error:', err);
    }
}

async function getBlingAccessToken() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bling_tokens?id=eq.1&select=access_token,refresh_token,expires_at`, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const row = rows[0];

    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) {
        return row.access_token;
    }

    const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${basicAuth}`
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: row.refresh_token
        })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
        console.error('Bling token refresh failed:', tokenData);
        return null;
    }

    const newExpiresAt = new Date(Date.now() + (tokenData.expires_in || 21600) * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/bling_tokens`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
            id: 1,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || row.refresh_token,
            expires_at: newExpiresAt,
            updated_at: new Date().toISOString()
        })
    });

    return tokenData.access_token;
}

async function emitBlingNfe(order) {
    try {
        if (!BLING_CLIENT_ID || !BLING_CLIENT_SECRET) return;
        if (!order.kit || String(order.kit).startsWith('CALC')) return; // calcinha fica de fora, só sutiã

        const tamanhoPrefixo = String(order.tamanho || '').split(' ')[0].toUpperCase();
        const sku = BLING_SKU_POR_TAMANHO[tamanhoPrefixo];
        if (!sku) {
            console.error('Bling NF-e: tamanho não mapeado para SKU:', order.tamanho, '(pedido', order.id, ')');
            return;
        }

        const accessToken = await getBlingAccessToken();
        if (!accessToken) {
            console.error('Bling NF-e: token de acesso indisponível (pedido', order.id, ')');
            return;
        }

        const cpf = String(order.cpf || '').replace(/\D/g, '');
        const quantidade = parseInt(order.quantidade, 10) || 1;
        const totalPedido = parseFloat(order.total) || 0;
        const valorUnitario = quantidade > 0 ? Math.round((totalPedido / quantidade) * 100) / 100 : totalPedido;

        const body = {
            tipo: 1,
            dataOperacao: new Date().toISOString().slice(0, 10),
            contato: {
                nome: order.nome || '',
                tipoPessoa: 'F',
                numeroDocumento: cpf,
                telefone: order.telefone || undefined,
                email: order.email || undefined,
                endereco: {
                    endereco: order.rua || '',
                    numero: order.numero || 'S/N',
                    complemento: order.complemento || undefined,
                    bairro: order.bairro || '',
                    cep: String(order.cep || '').replace(/\D/g, ''),
                    municipio: order.cidade || '',
                    uf: order.estado || undefined
                }
            },
            naturezaOperacao: { id: BLING_NATUREZA_OPERACAO_ID },
            finalidade: 1,
            itens: [{
                codigo: sku,
                unidade: 'UN',
                quantidade,
                valor: valorUnitario
            }],
            parcelas: [{
                data: new Date().toISOString().slice(0, 10),
                valor: totalPedido
            }]
        };

        const createRes = await fetch('https://api.bling.com.br/Api/v3/nfe', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const createData = await createRes.json();

        if (!createRes.ok || !createData?.data?.id) {
            console.error('Bling NF-e create failed (pedido', order.id, '):', JSON.stringify(createData));
            return;
        }

        const idNotaFiscal = createData.data.id;

        const sendRes = await fetch(`https://api.bling.com.br/Api/v3/nfe/${idNotaFiscal}/enviar`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!sendRes.ok) {
            const errText = await sendRes.text();
            console.error('Bling NF-e send failed (pedido', order.id, '):', errText);
        }
    } catch (err) {
        console.error('Bling NF-e error (pedido', order?.id, '):', err);
    }
}
