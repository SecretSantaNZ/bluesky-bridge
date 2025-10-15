ATTACH DATABASE './bakup/data.sqlite' as dev;

delete from mastodon_client;
insert into mastodon_client select * from dev.mastodon_client;
delete from at_oauth_session;
insert into at_oauth_session select * from dev.at_oauth_session;
delete from at_oauth_state;
insert into at_oauth_state select * from dev.at_oauth_state;
delete from otp_login;
insert into otp_login select * from dev.otp_login;
delete from jwk_key;
insert into jwk_key select * from dev.jwk_key;
delete from jwt_mac_key;
insert into jwt_mac_key select * from dev.jwt_mac_key;
delete from settings;
insert into settings select * from dev.settings;

