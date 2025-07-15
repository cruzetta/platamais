// Este ficheiro contém a "chave secreta" para conectar o seu site ao seu projeto Firebase.

// Declarar variáveis no escopo global para serem acessíveis por outros scripts
let app;
let db;
let auth;

// As suas informações de configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBuB3dTMtejuuVMekhUVmzX343IG8zIzYg",
  authDomain: "platamais.firebaseapp.com",
  projectId: "platamais",
  storageBucket: "platamais.appspot.com",
  messagingSenderId: "1014260724484",
  appId: "1:1014260724484:web:b6c3216ea4641714291651",
  measurementId: "G-0GLM073GEG"
};

// Inicializa o Firebase apenas se ainda não tiver sido inicializado.
// Isto previne o erro "Firebase App named '[DEFAULT]' already exists" ao navegar entre páginas.
if (!firebase.apps.length) {
  app = firebase.initializeApp(firebaseConfig);
} else {
  app = firebase.app(); // Se já inicializado, pega a instância existente
}

// Prepara os serviços do Firebase que vamos usar
db = firebase.firestore();
auth = firebase.auth();

// Opcional: Inicializa outros serviços se necessário
// const storage = firebase.storage();
// const analytics = firebase.analytics();
