const functions = require("firebase-functions");
const { MercadoPagoConfig, Payment } = require("mercadopago");

// ESTA É A LINHA CORRIGIDA
const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

// O resto do código permanece o mesmo
const client = new MercadoPagoConfig({ accessToken });
const payment = new Payment(client);

exports.createPixPayment = functions.https.onCall(async (data, context) => {
    // Validação básica de dados de entrada
    if (!data.email || !data.firstName || !data.price) {
      throw new functions.https.HttpsError('invalid-argument', 'O email, nome e preço são obrigatórios.');
    }

    const paymentData = {
      body: {
        transaction_amount: data.price,
        description: data.productName || "E-book: Resolva ou Reclama?",
        payment_method_id: "pix",
        payer: {
          email: data.email,
          first_name: data.firstName,
        },
        notification_url: "https://seuservidor.com/webhook", // Vamos configurar isto depois
      }
    };

    console.log("Criando pagamento PIX para:", data.email);

    try {
      const result = await payment.create(paymentData);
      
      const pixData = {
        paymentId: result.id,
        qrCode: result.point_of_interaction.transaction_data.qr_code,
        qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64,
      };

      console.log("PIX gerado com sucesso:", pixData.paymentId);
      return pixData;

    } catch (error) {
      console.error("Erro ao gerar PIX:", error.cause || error);
      throw new functions.https.HttpsError('internal', 'Não foi possível gerar o pagamento PIX.');
    }
});