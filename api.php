<?php
header("Content-Type: application/json");

// BASES
$remoteBaseGeneral = "https://valentin.jbcomputers.com.gt/api/v1";
$remoteBaseMachine = "https://valentin.jbcomputers.com.gt/machine/monkeychef/api/v1";

// VALIDAR
if (!isset($_GET['endpoint'])) {
    echo json_encode(["error" => "No endpoint"]);
    exit;
}

$endpoint = trim($_GET['endpoint'], "/");

// ---- ENDPOINTS DE MAQUINA ----
if ($endpoint === "stockmachine") {
    $idMachine = $_GET["idMachine"] ?? "";
    $url = "$remoteBaseMachine/stockmachine/getStockMachine?idMachine=" . urlencode($idMachine);
}
else if ($endpoint === "findmachines") {
    $url = "$remoteBaseMachine/machine/findAll";
}
// ---- ENDPOINT NORMAL ----
else {
    $url = "$remoteBaseGeneral/$endpoint";
}

// PETICIÓN
$resp = @file_get_contents($url);

if ($resp === false) {
    http_response_code(502);
    echo json_encode(["error" => "Bad Gateway", "url" => $url]);
    exit;
}

echo $resp;
