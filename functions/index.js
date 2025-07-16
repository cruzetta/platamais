const functions = require("firebase-functions");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { getStorage } = require("firebase-admin/storage");
const admin = require("firebase-admin");

admin.initializeApp();

// O Firebase vai disponibilizar o segredo aqui automaticamente
const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

// Inicializa o cliente do Mercado Pago com a nova sintaxe
const client = new MercadoPagoConfig({ accessToken });
const payment = new Payment(client);

exports.createPixPayment = functions.https.onCall(async (data, context) => {
    // Validação de dados de entrada
    if (!data.email || !data.firstName) {
      throw new functions.https.HttpsError('invalid-argument', 'O email e o nome são obrigatórios.');
    }

    // Preço definido de forma segura no servidor
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

exports.mercadoPagoWebhook = functions.https.onRequest(async (req, res) => {
    const paymentId = req.query.id;
    const type = req.query.type;

    if (type === "payment") {
        console.log(`Recebida notificação para o pagamento: ${paymentId}`);
        try {
            const paymentInfo = await payment.get({ id: paymentId });

            if (paymentInfo.status === "approved") {
                console.log(`Pagamento ${paymentId} APROVADO!`);

                const customerEmail = paymentInfo.payer.email;
                const bookPath = "RESOLVE OU RECLAMA PDF (1).pdf";

                const bucket = getStorage().bucket();
                const file = bucket.file(bookPath);

                const [signedUrl] = await file.getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 24 * 60 * 60 * 1000, // 24 horas
                });
                
                console.log(`Link seguro gerado para ${customerEmail}: ${signedUrl}`);
                
                await admin.firestore().collection('vendas').doc(String(paymentId)).set({
                    email: customerEmail,
                    downloadUrl: signedUrl,
                    status: 'entregue',
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                console.log("Venda registada no Firestore.");
            }

        } catch (error) {
            console.error("Erro no webhook:", error);
            res.status(500).send("Erro ao processar notificação.");
            return;
        }
    }
    
    res.status(200).send("Notificação recebida.");
});
