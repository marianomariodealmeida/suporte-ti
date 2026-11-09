-- ============================================================
-- Suporte TI · categorias iniciais
-- Pode rodar de novo sem duplicar (on conflict do nothing).
-- ============================================================

insert into public.categories (slug, name, color, icon, keywords, sort_order) values
  ('rede', 'Rede e Internet', '#0ea5e9', '🌐',
    array['rede', 'internet', 'wifi', 'wi-fi', 'cabo', 'switch', 'roteador', 'vpn', 'conexao', 'conexão', 'lento', 'ping', 'dns', 'sem rede', 'caiu a rede'], 10),
  ('impressora', 'Impressoras', '#8b5cf6', '🖨️',
    array['impressora', 'imprimir', 'toner', 'tinta', 'papel', 'scanner', 'digitalizar', 'atolado', 'impressao', 'impressão'], 20),
  ('acesso', 'Acessos e Senhas', '#f59e0b', '🔑',
    array['senha', 'acesso', 'login', 'bloqueado', 'bloqueio', 'usuario', 'usuário', 'permissao', 'permissão', 'conta', 'reset', 'desbloquear', 'trocar senha'], 30),
  ('email', 'E-mail', '#10b981', '📧',
    array['email', 'e-mail', 'outlook', 'caixa', 'spam', 'anexo', 'smtp', 'mensagem nao chega', 'mensagem não chega'], 40),
  ('hardware', 'Computadores e Hardware', '#ef4444', '💻',
    array['computador', 'notebook', 'pc', 'monitor', 'teclado', 'mouse', 'hd', 'ssd', 'memoria', 'memória', 'nao liga', 'não liga', 'tela', 'bateria', 'cpu', 'estabilizador'], 50),
  ('software', 'Sistemas e Software', '#6366f1', '⚙️',
    array['sistema', 'software', 'programa', 'instalar', 'instalacao', 'instalação', 'erro', 'travando', 'atualizar', 'licenca', 'licença', 'office', 'excel', 'word', 'sistema interno', 'nao abre', 'não abre'], 60),
  ('telefonia', 'Telefonia', '#14b8a6', '📞',
    array['telefone', 'ramal', 'voip', 'celular', 'ligacao', 'ligação', 'headset', 'chamada'], 70),
  ('backup', 'Backup e Dados', '#e11d48', '💾',
    array['backup', 'restaurar', 'recuperar', 'arquivo', 'perdi', 'perda', 'dados', 'pasta', 'exclui', 'excluí'], 80),
  ('outros', 'Outros', '#64748b', '📋',
    array[]::text[], 999)
on conflict (slug) do nothing;
