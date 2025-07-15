// Este ficheiro contém a "chave secreta" para conectar o seu site ao seu projeto Firebase.

// As suas informações de configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBuB3dTMtejuuVMekhUVmzX343IG8zIzYg",
  authDomain: "platamais.firebaseapp.com",
  projectId: "platamais",
  storageBucket: "platamais.firebasestorage.app",
  messagingSenderId: "1014260724484",
  appId: "1:1014260724484:web:b6c3216ea4641714291651",
  measurementId: "G-0GLM073GEG"
};

// Inicializa o Firebase com as suas configurações
const app = firebase.initializeApp(firebaseConfig);

// Prepara os serviços do Firebase que vamos usar (Banco de Dados e Armazenamento de Ficheiros)
const db = firebase.firestore();
const storage = firebase.storage();

// Opcional: Inicializa o Analytics para ver as estatísticas do seu site
const analytics = firebase.analytics();
