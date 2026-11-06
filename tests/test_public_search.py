"""Pages publiques, refus explicites et conservation des comptes privés."""
import json
import unittest
from unittest.mock import patch

import boards
import public_search
import test_accounts as fixtures


PAGE = '''<html><ul><li><div class="base-search-card">
<a class="base-card__full-link" href="https://fr.linkedin.com/jobs/view/technicien-12345678?tracking=1"><span>Technicien</span></a>
<h3 class="base-search-card__title">Technicien support Windows</h3>
<h4 class="base-search-card__subtitle">Entreprise Exemple</h4>
<span class="job-search-card__location">Lyon</span><time datetime="2026-11-06"></time>
</div></li><li><a href="https://evil.example/jobs/123456">Mauvais lien</a></li></ul></html>'''


class PublicParserTests(unittest.TestCase):
    def setUp(self):
        public_search.CACHE.clear()

    def test_only_real_canonical_offers_are_read_and_deduplicated(self):
        rows = public_search.parse_page('linkedin', PAGE + PAGE, 'https://www.linkedin.com/jobs/search/')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['title'], 'Technicien support Windows')
        self.assertEqual(rows[0]['company'], 'Entreprise Exemple')
        self.assertEqual(rows[0]['location'], 'Lyon')
        self.assertEqual(rows[0]['url'], 'https://www.linkedin.com/jobs/view/12345678/')
        self.assertEqual(rows[0]['posted'], '2026-11-06')

    def test_structured_job_data_is_preserved_without_inventing_company_or_city(self):
        raw = '<script type="application/ld+json">' + json.dumps({'@graph': [{'@type': 'JobPosting', 'url': 'https://www.hellowork.com/fr-fr/emplois/12345678.html', 'title': 'Support', 'description': 'Missions réelles'}]}) + '</script>'
        rows = public_search.parse_page('hellowork', raw, 'https://www.hellowork.com/')
        self.assertEqual(len(rows), 1)
        offer = boards.parse_offer('hellowork', rows[0])
        self.assertEqual(offer['company'], 'Entreprise non précisée')
        self.assertEqual(offer['location'], 'Lieu non précisé')

    def test_hellowork_visible_company_and_place_are_separate_from_title(self):
        raw = '''<li><header><a href="/fr-fr/emplois/12345678.html" data-cy="offerTitle" aria-label="Voir offre de Vendeur H/F à Lyon, chez Exemple, pour un CDI, en temps plein"><h3><span>Vendeur H/F</span><span>Exemple</span></h3></a></header></li>'''
        row = public_search.parse_page('hellowork', raw, 'https://www.hellowork.com/')[0]
        self.assertEqual((row['title'], row['company'], row['location'], row['contract']), ('Vendeur H/F', 'Exemple', 'Lyon', 'CDI'))

    def test_meteojob_company_place_and_contract_come_from_the_same_card(self):
        raw = '''<article><h2><a href="/jobs/12345678">Vendeur</a></h2><p class="d-inline-block">Exemple</p><div class="cc-badge-gray">place Lyon 03 (69)</div><div class="cc-badge-gray">Intérim</div></article>'''
        row = public_search.parse_page('meteojob', raw, 'https://www.meteojob.com/')[0]
        self.assertEqual((row['company'], row['location'], row['contract']), ('Exemple', 'Lyon 03 (69)', 'Intérim'))

    def test_blocked_empty_and_challenge_are_not_reported_as_zero_jobs(self):
        for raw in ['<html>Aucun contenu exploitable</html>', '<html><div class="cf-chl-test">challenge-platform</div></html>']:
            public_search.CACHE.clear()
            with patch.object(public_search, 'fetch_page', return_value=raw):
                result = public_search.search_site('linkedin', 'support', 'Lyon')
            self.assertEqual(result['status'], 'unavailable')
            self.assertTrue(result['partial'])
            self.assertEqual(result['offers'], [])
        public_search.CACHE.clear()
        with patch.object(public_search, 'fetch_page', side_effect=OSError('blocked')):
            self.assertEqual(public_search.search_site('linkedin', 'support', 'Lyon')['status'], 'unavailable')

    def test_cache_is_bounded_and_cannot_be_mutated_by_a_tenant(self):
        with patch.object(public_search, 'fetch_page', return_value=PAGE) as fetch:
            a = public_search.search_site('linkedin', 'support', 'Lyon')
            a['offers'][0]['title'] = 'Modification privée'
            b = public_search.search_site('linkedin', 'support', 'Lyon')
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(b['offers'][0]['title'], 'Technicien support Windows')
            self.assertEqual(b['status'], 'results')

    def test_redirects_to_private_auth_or_another_host_are_refused(self):
        request = public_search.urllib.request.Request('https://www.linkedin.com/jobs/search/')
        redirect = public_search.PublicRedirect()
        for target in ['http://www.linkedin.com/jobs/', 'https://evil.example/', 'https://www.linkedin.com/login', 'https://www.linkedin.com:444/jobs/']:
            with self.assertRaises(ValueError):
                redirect.redirect_request(request, None, 302, '', {}, target)

    def test_detail_reads_only_description_and_a_contact_published_in_the_offer(self):
        raw = '<div class="show-more-less-html__markup">' + 'Assistance utilisateurs Windows. ' * 8 + '</div><section class="message-the-recruiter"><p>Recrutement pour cette entreprise</p><a href="https://www.linkedin.com/in/contact-exemple/">Alex Exemple</a></section>'
        with patch.object(public_search, 'fetch_page', return_value=raw):
            result = public_search.read_detail('linkedin', 'https://www.linkedin.com/jobs/view/12345678/')
        self.assertEqual(result['status'], 'done')
        self.assertTrue(result['full'])
        self.assertIn('Windows', result['description'])
        self.assertEqual(result['people'][0]['name'], 'Alex Exemple')


class PublicCloudTests(unittest.TestCase):
    setUp = fixtures.AccountTests.setUp
    tearDown = fixtures.AccountTests.tearDown
    call = fixtures.AccountTests.call
    form = fixtures.AccountTests.form
    client = fixtures.AccountTests.client
    state = fixtures.AccountTests.state
    def test_six_character_password_login_and_recovery(self):
        alice = self.client('alice', password='six123')
        self.client('alice', password='six123', register=False)
        self.assertEqual(self.form('recover', {'username': 'alice', 'recovery_code': alice['code'], 'password': 'new123', 'confirmation': 'new123'})['status'], 200)
        self.client('alice', password='new123', register=False)
        self.assertEqual(self.form('register', {'username': 'bob', 'password': 'court', 'confirmation': 'court'})['status'], 400)

    def test_simple_start_requires_only_query_city_and_keeps_existing_profile(self):
        alice = self.client('alice')
        self.call('/api/profile', data={'city': 'Lyon', 'query': 'support'}, **{k: alice[k] for k in ('cookie', 'token')})
        response = self.call('/api/setup/finish', data={}, **{k: alice[k] for k in ('cookie', 'token')})
        self.assertEqual(response['status'], 200, response['body'])
        self.assertTrue(json.loads(response['body'])['config']['onboarding_done'])
        self.assertEqual(self.state(alice)['profile']['name'], '')

    def test_public_results_remain_private_and_reject_stale_searches_and_tokens(self):
        alice, bob = self.client('alice'), self.client('bob')
        def start(client):
            return self.call('/api/public/search/start', data={'query': 'support', 'city': 'Lyon'}, cookie=client['cookie'], token=client['token'])
        response = start(alice)
        self.assertEqual(response['status'], 200, response['body'])
        search = json.loads(response['body'])
        self.assertEqual(search['access_mode'], 'public')
        result = {'source_id': 'linkedin', 'status': 'results', 'partial': True, 'offers': public_search.parse_page('linkedin', PAGE, ''), 'message': 'Public'}
        payload = {'search_id': search['search_id'], 'source_id': 'linkedin'}
        with patch.object(public_search, 'search_site', return_value=result) as fetch:
            self.assertEqual(self.call('/api/public/search/site', data=payload, cookie=bob['cookie'], token=alice['token'])['status'], 403)
            self.assertEqual(fetch.call_count, 0)
            response = self.call('/api/public/search/site', data=payload, cookie=alice['cookie'], token=alice['token'])
            self.assertEqual(response['status'], 200, response['body'])
            self.assertEqual(len(json.loads(response['body'])['offers']), 1)
            self.assertEqual(self.state(bob)['feed']['offers'], [])
            offer = json.loads(response['body'])['offers'][0]
            with patch.object(public_search, 'read_detail', return_value={'status': 'done', 'description': 'Assistance utilisateurs Windows. ' * 8, 'full': True, 'people': [], 'message': 'Public'}):
                prepared = self.call('/api/offer/prepare', data={'offer_id': offer['offer_id']}, cookie=alice['cookie'], token=alice['token'])
                self.assertEqual(prepared['status'], 200, prepared['body'])
                job = json.loads(prepared['body'])
                self.assertEqual(job['description_kind'], 'full')
                self.assertIn('Windows', job['description'])
                self.assertTrue(job['letter_text'])
            start(alice)
            self.assertEqual(self.call('/api/public/search/site', data=payload, cookie=alice['cookie'], token=alice['token'])['status'], 400)
            self.assertEqual(fetch.call_count, 1)
        self.assertEqual(self.call('/api/public/search/start', data={'query': 'support', 'city': 'Lyon'})['status'], 401)


if __name__ == '__main__':
    unittest.main()
