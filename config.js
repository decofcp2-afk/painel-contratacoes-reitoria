window.PAINEL_CONFIG = {
  // URL /exec do Apps Script — mantida por compatibilidade durante a transicao.
  apiUrl: "https://script.google.com/macros/s/AKfycby1QQr6sq9Tk1W2Xb6aMkaMzW8w4B3d6Aegr9vZ3TtSoNmc-5JjbFkPdoIsc1Ra4zBZ/exec",

  // Liga/desliga a leitura via Firestore no corte da Fase 3.
  // Mantenha false ate o App Gestao estar gravando no Firestore (senao painel desatualiza).
  firestoreAtivo: true,

  // Firestore (leitura direta — substitui as chamadas de consulta ao Apps Script).
  // A apiKey abaixo NAO e segredo: quem protege os dados sao as regras do Firestore.
  firebase: {
    apiKey: "AIzaSyBqtGYiH8Kfkvitfwe1si_DfFqz0P7bV5o",
    authDomain: "gestao-de-processos-a0099.firebaseapp.com",
    projectId: "gestao-de-processos-a0099",
    storageBucket: "gestao-de-processos-a0099.firebasestorage.app",
    messagingSenderId: "41645752441",
    appId: "1:41645752441:web:c16e21168c8336773f94a8"
  }
};
