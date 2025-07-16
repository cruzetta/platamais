const {onCall} = require("firebase-functions/v2/https");
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");

const { MercadoPagoConfig, Payment } = require("mercadopago");
const admin = require("firebase-admin");
const { getStorage } = require("firebase-admin/storage");

admin.initializeApp();
const db = admin.firestore();

const mercadoPagoAccessToken = defineSecret("MERCADO_PAGO_ACCESS_TOKEN");

/**
 * Cria um pagamento PIX buscando os detalhes do produto no Firestore.
 */
exports.createPixPayment = onCall({ secrets: [mercadoPagoAccessToken] }, async (request) => {
    const data = request.data;
    // Validação dos dados de entrada
    if (!data.email || !data.firstName || !data.productId) {
      throw new Error('Email, nome e ID do produto são obrigatórios.');
    }

    // 1. Buscar o produto no Firestore
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
    
    // Define a data de expiração para 10 minutos a partir de agora
    const expirationDate = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos em milissegundos

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
        // Adiciona o productId aos metadados para ser usado no webhook
        metadata: {
            productId: data.productId 
        }
      }
    };

    console.log(`Criando pagamento PIX para: ${data.email} | Produto: ${productName} (R$ ${productPrice})`);

    try {
      const result = await payment.create(paymentData);
      const paymentId = String(result.id);
      
      // Salva a venda com o status 'pending' e o ID do produto
      await db.collection('vendas').doc(paymentId).set({
          email: data.email,
          firstName: data.firstName,
          status: 'pending',
          productId: data.productId, // Salva o ID do produto na venda
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

            // Apenas processa se o pagamento estiver aprovado
            if (paymentInfo.status === 'approved') {
                await db.collection('vendas').doc(String(paymentId)).update({
                    status: 'approved',
                    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
                    // Adiciona os metadados recebidos para referência futura
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
 * Verifica o status de um pagamento e, se aprovado, retorna o link de download.
 */
exports.checkPaymentStatusAndGetLink = onCall({ secrets: [mercadoPagoAccessToken] }, async (request) => {
    const paymentId = request.data.paymentId;
    if (!paymentId) {
        throw new Error("ID do pagamento é obrigatório.");
    }

    try {
        // 1. Verifica o status do pagamento no Mercado Pago
        const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken.value() });
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: paymentId });

        if (paymentInfo.status !== 'approved') {
            return { status: paymentInfo.status, downloadUrl: null };
        }

        // 2. Se aprovado, busca os detalhes da venda no Firestore
        const vendaRef = db.collection('vendas').doc(paymentId);
        const vendaSnap = await vendaRef.get();
        if (!vendaSnap.exists) {
            throw new Error("Detalhes da venda não encontrados no Firestore.");
        }
        const vendaData = vendaSnap.data();
        const productId = vendaData.productId;

        // 3. Busca os detalhes do produto para obter o caminho do ficheiro
        const productRef = db.collection('products').doc(productId);
        const productSnap = await productRef.get();
        if (!productSnap.exists) {
            throw new Error("Produto associado à venda não encontrado.");
        }
        const productData = productSnap.data();
        const filePath = productData.caminhoDoFicheiro; // e.g., 'ebooks/resolve-ou-reclama.pdf'

        if (!filePath) {
             throw new Error("Caminho do ficheiro não definido para este produto.");
        }

        // 4. Gera um link de download assinado e de curta duração para o ficheiro no Storage
        const storage = getStorage();
        const bucket = storage.bucket(); // Usa o bucket padrão
        const file = bucket.file(filePath);
        
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000, // O link expira em 15 minutos
        });

        console.log(`Link de download gerado para o produto ${productId}: ${url}`);

        // Atualiza o registro da venda com o status de 'delivered'
        await vendaRef.update({
            status: 'delivered',
            deliveredAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { status: 'approved', downloadUrl: url };

    } catch (error) {
        console.error(`Erro ao verificar status ou gerar link para ${paymentId}:`, error.cause || error);
        throw new Error('Não foi possível concluir o processo de verificação e entrega.');
    }
});
