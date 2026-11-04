<?php
/**
 * Сборщик статистики ОБЗВОН v7.0 — анонимный, с пересылкой тревог в Telegram.
 *
 * Кладётся РЯДОМ с index.html (тот же домен — иначе сайт не сможет
 * обратиться к нему: в CSP разрешён только свой origin).
 *
 * Что делает:
 *   POST  → принимает событие {id, ev, ts, d?} и пишет его в data/stats.json;
 *   GET   → отдаёт сводку: сколько людей заходило, сколько визитов,
 *           сколько калибровок, обзвонов и тревог + последние события.
 *
 * Тревоги (ev = "alarm") уходят в Telegram, если рядом лежит
 * telegram.local.json:
 *   { "enabled": true, "token": "123456:ABC...", "chat": "123456789" }
 * (файл в .gitignore — токен бота в репозитории лежать не должен)
 *
 * Личные данные не передаются: только случайный id устройства,
 * тип события и время.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$dir  = __DIR__ . '/data';
$file = $dir . '/stats.json';
$tgFile = __DIR__ . '/telegram.local.json';

if (!is_dir($dir)) {
    @mkdir($dir, 0775, true);
}

function obz_read(string $file): array
{
    if (!file_exists($file)) {
        return ['people' => [], 'events' => [], 'recent' => [], 'updatedAt' => null, 'last' => 0];
    }
    $raw = @file_get_contents($file);
    $d = $raw ? json_decode($raw, true) : null;
    if (!is_array($d)) {
        return ['people' => [], 'events' => [], 'recent' => [], 'updatedAt' => null, 'last' => 0];
    }
    $d['people'] = isset($d['people']) && is_array($d['people']) ? $d['people'] : [];
    $d['events'] = isset($d['events']) && is_array($d['events']) ? $d['events'] : [];
    $d['recent'] = isset($d['recent']) && is_array($d['recent']) ? $d['recent'] : [];
    return $d;
}

function obz_write(string $file, array $data): void
{
    @file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
}

/* пересылка тревоги в Telegram */
function obz_telegram(string $file, string $text): void
{
    if (!file_exists($file)) {
        return;
    }
    $cfg = json_decode((string)@file_get_contents($file), true);
    if (!is_array($cfg) || empty($cfg['enabled']) || empty($cfg['token']) || empty($cfg['chat'])) {
        return;
    }
    $url = 'https://api.telegram.org/bot' . $cfg['token'] . '/sendMessage';
    $payload = json_encode([
        'chat_id' => $cfg['chat'],
        'text'    => 'ОБЗВОН · тревога: ' . $text,
        'parse_mode' => 'HTML',
    ], JSON_UNESCAPED_UNICODE);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT => 8,
    ]);
    curl_exec($ch);
    curl_close($ch);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
    $in = json_decode(file_get_contents('php://input'), true);
    if (!is_array($in) || !isset($in['id'], $in['ev'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'нужен id и ev']);
        exit;
    }
    $id = preg_replace('/[^a-z0-9]/i', '', (string)$in['id']);
    $ev = preg_replace('/[^a-z_.]/i', '', (string)$in['ev']);
    if ($id === '' || $ev === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'пустые id или ev']);
        exit;
    }
    $ts = isset($in['ts']) ? (int)$in['ts'] : time() * 1000;
    $det = isset($in['d']) ? mb_substr((string)$in['d'], 0, 300) : '';

    $d = obz_read($file);
    $d['people'][$id] = (isset($d['people'][$id]) ? (int)$d['people'][$id] : 0) + 1;
    $d['events'][$ev] = (isset($d['events'][$ev]) ? (int)$d['events'][$ev] : 0) + 1;
    array_unshift($d['recent'], ['ev' => $ev, 'd' => $det, 'ts' => $ts, 'id' => substr($id, 0, 8)]);
    if (count($d['recent']) > 60) {
        $d['recent'] = array_slice($d['recent'], 0, 60);
    }
    $d['last'] = $ts;
    $d['updatedAt'] = date('c');
    obz_write($file, $d);

    if ($ev === 'alarm') {
        obz_telegram($tgFile, $det !== '' ? $det : $ev);
    }

    echo json_encode(['ok' => true]);
    exit;
}

if ($method === 'GET') {
    $d = obz_read($file);
    $visits = 0;
    foreach ($d['people'] as $n) {
        $visits += (int)$n;
    }
    echo json_encode([
        'ok'        => true,
        'visitors'  => count($d['people']),
        'visits'    => $visits,
        'events'    => $d['events'],
        'recent'    => array_slice($d['recent'], 0, 20),
        'updatedAt' => $d['updatedAt'],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'метод не поддерживается']);
