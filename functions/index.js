const {onCall} = require("firebase-functions/v2/https");
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");

const { MercadoPagoConfig, Payment } = require("mercadopago");
const admin = require("firebase-admin");
// A linha do Storage já não é necessária aqui, mas podemos manter para o futuro.
const { getStorage } = require("firebase-admin/storage");

admin.initializeApp();
const db = admin.firestore();

const mercadoPagoAccessToken = defineSecret("MERCADO_PAGO_ACCESS_TOKEN");

/**
 * Cria um pagamento PIX buscando os detalhes do produto no Firestore.
 */
exports.createPixPayment = onCall({ secrets: [mercadoPagoAccessToken] }, async (request) => {
    const data = request.data;
    if (!data.email || !data.firstName || !data.productId) {
      throw new Error('Email, nome e ID do produto são obrigatórios.');
    }

    const productRef = db.collection('products').doc(data.productId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
        console.error(`Produto com ID ${data.productId} não encontrado.`);
        throw new Error('Produto não encontrado.');
    }

    const productData = productSnap.data();
    const productPrice = productData.preco;
    const productName = productData.nome;

    const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken.value() });
    const payment = new Payment(client);
    
    const expirationDate = new Date(Date.now() + 10 * 60 * 1000);

    const paymentData = {
      body: {
        transaction_amount: productPrice,
        description: productName,
        payment_method_id: "pix",
        date_of_expiration: expirationDate.toISOString(),
        payer: {
          email: data.email,
          first_name: data.firstName,
        },
        notification_url: `https://us-central1-platamais.cloudfunctions.net/mercadoPagoWebhook`,
        metadata: {
            productId: data.productId 
        }
      }
    };

    console.log(`Criando pagamento PIX para: ${data.email} | Produto: ${productName} (R$ ${productPrice})`);

    try {
      const result = await payment.create(paymentData);
      const paymentId = String(result.id);
      
      await db.collection('vendas').doc(paymentId).set({
          email: data.email,
          firstName: data.firstName,
          status: 'pending',
          productId: data.productId,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const pixData = {
        paymentId: paymentId,
        qrCode: result.point_of_interaction.transaction_data.qr_code,
        qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64,
      };

      return pixData;

    } catch (error) {
      console.error("Erro ao gerar PIX:", error.cause || error);
      throw new Error('Não foi possível gerar o pagamento PIX.');
    }
});

/**
 * Webhook para processar notificações de pagamento do Mercado Pago.
 */
exports.mercadoPagoWebhook = onRequest({ secrets: [mercadoPagoAccessToken] }, async (req, res) => {
    const { id: paymentId, type } = req.query;

    if (type === "payment") {
        try {
            const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken.value() });
            const payment = new Payment(client);
            const paymentInfo = await payment.get({ id: paymentId });

            if (paymentInfo.status === 'approved') {
                await db.collection('vendas').doc(String(paymentId)).update({
                    status: 'approved',
                    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
                    mercadoPagoDetails: paymentInfo 
                });
                console.log(`Venda ${paymentId} marcada como APROVADA via webhook.`);
            } else {
                 console.log(`Webhook recebido para pagamento ${paymentId} com status: ${paymentInfo.status}. Nenhuma ação necessária.`);
            }

        } catch (error) {
            console.error("Erro no webhook ao buscar ou atualizar dados:", error);
            return res.status(500).send("Erro ao processar notificação.");
        }
    }
    
    res.status(200).send("Notificação recebida.");
});

/**
 * Apenas verifica o status de um pagamento.
 * Renomeada de volta para um nome mais simples, pois não gera mais o link.
 */
exports.checkPaymentStatus = onCall({ secrets: [mercadoPagoAccessToken] }, async (request) => {
    const paymentId = request.data.paymentId;
    if (!paymentId) {
        throw new Error("ID do pagamento é obrigatório.");
    }

    try {
        const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken.value() });
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: paymentId });
        
        // Se o pagamento for aprovado, atualiza o status no Firestore para 'delivered'
        if (paymentInfo.status === 'approved') {
             await db.collection('vendas').doc(paymentId).update({
                status: 'delivered',
                deliveredAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
        return { status: paymentInfo.status };

    } catch (error) {
        console.error(`Erro ao verificar status do pagamento ${paymentId}:`, error.cause || error);
        throw new Error('Não foi possível verificar o status do pagamento.');
    }
});
