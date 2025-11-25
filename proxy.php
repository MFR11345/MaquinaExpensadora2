<?php
// proxy.php - Generic proxy to fetch and stream external resources (images, etc.)

// --- CORS FIRST (antes de cualquier salida) ---
header_remove('Access-Control-Allow-Origin');
header('Access-Control-Allow-Origin: *'); 
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

// Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// --- Validación ---
if (!isset($_GET['url'])) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'url parameter required';
    exit;
}

$url = $_GET['url'];

// Solo http/https
if (!preg_match('#^https?://#i', $url)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Invalid URL';
    exit;
}

// --- cURL ---
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 20);
curl_setopt($ch, CURLOPT_HEADER, false); // <--- IMPORTANTE: NO reenviar headers remotos

$body = curl_exec($ch);
$content_type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);

if ($body === false) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Failed to fetch resource: ' . curl_error($ch);
    curl_close($ch);
    exit;
}

curl_close($ch);

// --- Header final ---
header('Content-Type: ' . ($content_type ?: 'application/octet-stream'));
http_response_code($status);

// --- Output ---
echo $body;
