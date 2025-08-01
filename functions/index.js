// Importações para a v2 do Firebase Functions
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { getStorage } = require("firebase-admin/storage");

// Importe o SDK do Google AI
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();
const db = admin.firestore();

// --- SEGREDOS (MÉTODO NOVO) ---
const mercadoPagoAccessToken = defineSecret("MERCADO_PAGO_ACCESS_TOKEN");
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// ===================================================================
// FUNÇÃO PARA O CINEPROMPT (Sintaxe v2) - ATUALIZADA COM SEGURANÇA
// ===================================================================
// CORREÇÃO: Renomeado para 'generateWithGemini' e região alterada para 'us-central1'
exports.generateWithGemini = onCall({ secrets: [geminiApiKey], region: "us-central1" }, async (request) => {
    // Verificação de Autenticação
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Você precisa estar autenticado para usar esta função.');
    }

    const data = request.data;
    
    const selectedCharacterDetails = (data.selectedCharacters || [])
      .map(char => `Personagem: ${char.name}. Descrição: ${char.description}. Visual: ${char.visuals}. Personalidade: ${char.personality}.`)
      .join(' ');

    const promptParts = [
        `Crie um prompt de vídeo detalhado para uma IA de geração de vídeo.`,
        `Estilo: ${data.videoStyle}.`,
        `Tema/Ambiente: ${data.theme}.`,
        `Narrativa: ${data.narrative}.`,
        selectedCharacterDetails,
        `Movimento de Câmera: ${data.cameraType}.`,
        `Iluminação: ${data.lighting}.`,
        `Paleta de Cores: ${data.colorPalette}.`,
        `Qualidade e Detalhes: ${data.quality}.`,
        `Formato: ${data.format}.`,
        `Duração aproximada: ${data.duration} segundos.`
    ];

    if (data.voiceNarration && data.voiceNarration !== 'Sem Narração') {
        promptParts.push(`Inclua uma narração com a voz "${data.voiceNarration}". O texto da narração deve ser gerado com base na narrativa.`);
    }

    const fullPrompt = promptParts.filter(p => p && p.trim() !== '').join(' ');
    const finalPromptForAI = `Gere um prompt para uma IA de vídeo, em ${data.outputLanguage === 'english' ? 'inglês' : 'português'}, baseado na seguinte ideia: ${fullPrompt}. O prompt final deve ser direto, técnico e otimizado para modelos como Sora, Runway ou Pika Labs, sem incluir minha introdução.`;

    if (!finalPromptForAI) {
        throw new HttpsError('invalid-argument', 'O prompt final não pôde ser construído. Verifique os dados enviados.');
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    try {
        const result = await model.generateContent(finalPromptForAI);
        const response = result.response;
        const text = response.text();
        return { prompt: text };

    } catch (error) {
        console.error("Erro ao chamar a API do Gemini:", error);
        throw new HttpsError('internal', 'Não foi possível gerar o conteúdo.', error);
    }
});


// --- FUNÇÕES DO MERCADO PAGO ---

// CORREÇÃO: Região alterada para 'us-central1'
exports.createPixPayment = onCall({ secrets: [mercadoPagoAccessToken], region: "us-central1" }, async (request) => {
    const data = request.data;
    if (!data.email || !data.firstName || !data.productId) {
      throw new HttpsError('invalid-argument', 'Email, nome e ID do produto são obrigatórios.');
    }

    const productRef = db.collection('products').doc(data.productId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
        console.error(`Produto com ID ${data.productId} não encontrado.`);
        throw new HttpsError('not-found', 'Produto não encontrado.');
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
        notification_url: `https://us-central1-platamais.cloudfunctions.net/mercadoPagoWebhook`, // CORREÇÃO: Região no URL
        metadata: {
            productId: data.productId 
        }
      }
    };

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

      return {
        paymentId: paymentId,
        qrCode: result.point_of_interaction.transaction_data.qr_code,
        qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64,
      };

    } catch (error) {
      console.error("Erro ao gerar PIX:", error.cause || error);
      throw new HttpsError('internal', 'Não foi possível gerar o pagamento PIX.');
    }
});

// CORREÇÃO: Região alterada para 'us-central1'
exports.mercadoPagoWebhook = onRequest({ secrets: [mercadoPagoAccessToken], region: "us-central1" }, async (req, res) => {
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
            }
        } catch (error) {
            console.error("Erro no webhook:", error);
            return res.status(500).send("Erro ao processar notificação.");
        }
    }
    
    res.status(200).send("Notificação recebida.");
});

// CORREÇÃO: Região alterada para 'us-central1'
exports.checkPaymentStatus = onCall({ secrets: [mercadoPagoAccessToken], region: "us-central1" }, async (request) => {
    const paymentId = request.data.paymentId;
    if (!paymentId) {
        throw new HttpsError("invalid-argument", "ID do pagamento é obrigatório.");
    }

    try {
        const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken.value() });
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: paymentId });
        
        if (paymentInfo.status === 'approved') {
             await db.collection('vendas').doc(paymentId).update({
                status: 'delivered',
                deliveredAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
        return { status: paymentInfo.status };

    } catch (error) {
        console.error(`Erro ao verificar status do pagamento ${paymentId}:`, error.cause || error);
        throw new HttpsError('internal', 'Não foi possível verificar o status do pagamento.');
    }
});
