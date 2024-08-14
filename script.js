function encriptarTexto() {
    let texto = document.getElementById("inputText").value;
    
    if (tieneCaracteresInvalidos(texto)) {
        mostrarWarning(true);
        return;
    }

    mostrarWarning(false);
    let textoEncriptado = texto
        .replace(/e/g, "enter")
        .replace(/i/g, "imes")
        .replace(/a/g, "ai")
        .replace(/o/g, "ober")
        .replace(/u/g, "ufat");
    mostrarResultado(textoEncriptado);

    var inputText = document.getElementById("inputText").value.trim();

    if (inputText === "") {
        alert("Debe ingresar un texto en minúsculas y sin caracteres especiales.");
    } else {
        console.log("Texto encriptado: " + inputText);
    }
}

function desencriptarTexto() {
    let texto = document.getElementById("inputText").value;

    if (tieneCaracteresInvalidos(texto)) {
        mostrarWarning(true);
        return;
    }

    mostrarWarning(false);
    let textoDesencriptado = texto
        .replace(/enter/g, "e")
        .replace(/imes/g, "i")
        .replace(/ai/g, "a")
        .replace(/ober/g, "o")
        .replace(/ufat/g, "u");
    mostrarResultado(textoDesencriptado);
}

function tieneCaracteresInvalidos(texto) {
    const regex = /[^a-z\s]/;
    return regex.test(texto);
}

function mostrarWarning(mostrar) {
    let warningMessage = document.getElementById("warningMessage");
    if (mostrar) {
        warningMessage.style.display = "block";
    } else {
        warningMessage.style.display = "none";
    }
}

function mostrarResultado(resultado) {
    let outputText = document.getElementById("outputText");
    let noMessageImg = document.getElementById("noMessageImg");

    if (resultado.length > 0) {
        outputText.textContent = resultado;
        noMessageImg.style.display = "none";
    } else {
        outputText.textContent = "Ningún mensaje fue encontrado";
        noMessageImg.style.display = "block";
    }
}

function copiarTexto() {
    let outputText = document.getElementById("outputText").textContent;
    navigator.clipboard.writeText(outputText).then(() => {
        alert("Texto copiado al portapapeles");
    });
}

