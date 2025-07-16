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
      
      // NOVO: Cria um registo da venda no Firestore com status 'pending'
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

// Função que recebe a notificação de pagamento do Mercado Pago
exports.mercadoPagoWebhook = onRequest(async (req, res) => {
    const paymentId = req.query.id;
    const type = req.query.type;

    if (type === "payment") {
        console.log(`Recebida notificação para o pagamento: ${paymentId}`);
        try {
            // Não precisamos de usar o token aqui, apenas confirmar o pagamento
            // A verificação da autenticidade do webhook pode ser adicionada no futuro
            
            // NOVO: Apenas atualiza o status da venda no Firestore para 'approved'
            await admin.firestore().collection('vendas').doc(String(paymentId)).update({
                status: 'approved',
                approvedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`Venda ${paymentId} marcada como APROVADA.`);

        } catch (error) {
            console.error("Erro no webhook ao atualizar o status:", error);
            res.status(500).send("Erro ao processar notificação.");
            return;
        }
    }
    
    res.status(200).send("Notificação recebida.");
});
