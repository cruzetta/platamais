const {onCall} = require("firebase-functions/v2/https");
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");

const { MercadoPagoConfig, Payment } = require("mercadopago");
const admin = require("firebase-admin");

admin.initializeApp();

const mercadoPagoAccessToken = defineSecret("MERCADO_PAGO_ACCESS_TOKEN");

// Função para criar o pagamento PIX
exports.createPixPayment = onCall({ secrets: [mercadoPagoAccessToken] }, async (request) => {
    const data = request.data;
    if (!data.email || !data.firstName) {
      throw new Error('O email e o nome são obrigatórios.');
    }

    const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken.value() });
    const payment = new Payment(client);
    const productPrice = 19.00;

    const paymentData = {
      body: {
        transaction_amount: productPrice,
        description: data.productName || "E-book: Resolva ou Reclama?",
        payment_method_id: "pix",
        payer: {
          email: data.email,
          first_name: data.firstName,
        },
        notification_url: `https://us-central1-platamais.cloudfunctions.net/mercadoPagoWebhook`,
      }
    };

    try {
      const result = await payment.create(paymentData);
      const paymentId = String(result.id);
      
      await admin.firestore().collection('vendas').doc(paymentId).set({
          email: data.email,
          firstName: data.firstName,
          status: 'pending',
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

// Função que recebe a notificação de pagamento do Mercado Pago (webhook)
exports.mercadoPagoWebhook = onRequest(async (req, res) => {
    const paymentId = req.query.id;
    const type = req.query.type;

    if (type === "payment") {
        try {
            await admin.firestore().collection('vendas').doc(String(paymentId)).update({
                status: 'approved',
                approvedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Venda ${paymentId} marcada como APROVADA via webhook.`);
        } catch (error) {
            console.error("Erro no webhook ao atualizar o status:", error);
            res.status(500).send("Erro ao processar notificação.");
            return;
        }
    }
    
    res.status(200).send("Notificação recebida.");
});

// ===== NOVA FUNÇÃO PARA VERIFICAÇÃO INSTANTÂNEA =====
exports.checkPaymentStatus = onCall({ secrets: [mercadoPagoAccessToken] }, async (request) => {
    const paymentId = request.data.paymentId;
    if (!paymentId) {
        throw new Error("ID do pagamento é obrigatório.");
    }

    try {
        const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken.value() });
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: paymentId });
        
        // Retorna o status diretamente da API do Mercado Pago
        return { status: paymentInfo.status };

    } catch (error) {
        console.error(`Erro ao verificar status do pagamento ${paymentId}:`, error.cause || error);
        throw new Error('Não foi possível verificar o status do pagamento.');
    }
});
