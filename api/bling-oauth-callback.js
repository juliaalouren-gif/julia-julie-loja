const BLING_CLIENT_ID     = process.env.BLING_CLIENT_ID;
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET;
const BLING_REDIRECT_URI  = 'https://www.juliajuliesutia.com.br/api/bling-oauth-callback';
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_KEY        = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`Erro na autorização do Bling: ${error}`);
    if (!code) return res.status(400).send('Código de autorização ausente.');

    try {
        const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
        const tokenRes = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${basicAuth}`
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: BLING_REDIRECT_URI
            })
        });
        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) {
            console.error('Bling token exchange failed:', tokenData);
            return res.status(500).send('Falha ao trocar código por token. Verifique os logs no Vercel.');
        }

        const expiresAt = new Date(Date.now() + (tokenData.expires_in || 21600) * 1000).toISOString();

        const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/bling_tokens`, {
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
                refresh_token: tokenData.refresh_token,
                expires_at: expiresAt,
                updated_at: new Date().toISOString()
            })
        });

        if (!saveRes.ok) {
            const errText = await saveRes.text();
            console.error('Failed to save Bling tokens to Supabase:', errText);
            return res.status(500).send('Token recebido do Bling, mas falhou ao salvar no banco. Verifique os logs.');
        }

        return res.status(200).send('Bling conectado com sucesso! Pode fechar esta aba.');
    } catch (err) {
        console.error('Bling OAuth callback error:', err);
        return res.status(500).send('Erro interno ao conectar com o Bling.');
    }
};
